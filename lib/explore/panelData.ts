export interface PanelArtist {
  id: string
  name: string
}

export interface PanelRelease {
  id: string
  title: string
  date?: string
  artist: PanelArtist
}

/** A pool artist: panel discovery works client-side on these. */
export interface PoolArtist {
  id: string
  name: string
  /** Top MusicBrainz tag names — the place's genre fingerprint. */
  tags: string[]
}

export interface CountryYearDetails {
  totalCount: number
  /**
   * Artists whose MusicBrainz origin is this country, active in the
   * range, ranked by significance — shown before the pressing-derived
   * results. Empty when the origin lookup found nothing (or failed).
   */
  originArtists: PanelArtist[]
  /**
   * The discovery pool: era-active artists in popularity order with
   * their tags (≤300) — powers tiers, in-panel genre chips, and name
   * search with zero extra requests. Absent on cached pre-pool
   * responses; the panel degrades to the top-12 list.
   */
  panelArtists?: PoolArtist[]
  /** Artists credited on the issued-here releases (the fallback list). */
  artists: PanelArtist[]
  releases: PanelRelease[]
}

export function musicBrainzArtistUrl(id: string): string {
  return `https://musicbrainz.org/artist/${id}`
}

/** An artist's outbound links, classified from MusicBrainz URL relations. */
export interface ArtistLinks {
  spotify?: string
  appleMusic?: string
  amazonMusic?: string
  youtube?: string
  website?: string
  wikipedia?: string
}

export async function fetchArtistLinks(
  mbid: string,
  signal: AbortSignal,
): Promise<ArtistLinks> {
  const res = await fetch(`/api/explore/artist-links/${mbid}`, { signal })
  if (!res.ok) throw new Error('Could not load artist links')
  return res.json()
}

export function musicBrainzReleaseUrl(id: string): string {
  return `https://musicbrainz.org/release/${id}`
}

/** Plain YouTube search — no API, just a link out. */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

export interface PlaceResult {
  country: string
  area: string
}

export type SearchResult =
  | { kind: 'place'; country: string; area: string }
  | { kind: 'artist'; artist: { mbid: string; name: string } }

export async function searchExplore(
  query: string,
  signal: AbortSignal,
): Promise<SearchResult> {
  const res = await resilientFetch(
    'search',
    `/api/explore/search?q=${encodeURIComponent(query)}`,
    signal,
  )
  if (res.status === 404) {
    throw new Error(
      "Couldn't find that — try a city, country, or artist name.",
    )
  }
  if (res.status === 429) {
    throw new Error('MusicBrainz is busy — try again in a moment.')
  }
  if (!res.ok) {
    throw new Error('Search failed — please try again.')
  }
  const body = (await res.json()) as Partial<PlaceResult> & {
    kind?: SearchResult['kind']
    artist?: { mbid: string; name: string }
  }
  // CDN-cached responses from before the artist fallback carry no kind.
  if (body.kind === 'artist' && body.artist) {
    return { kind: 'artist', artist: body.artist }
  }
  if (body.country && body.area) {
    return { kind: 'place', country: body.country, area: body.area }
  }
  throw new Error('Search failed — please try again.')
}

export interface ArtistEraRelease {
  id: string
  title: string
  date: string
  type?: string
}

export interface ArtistEraDetails {
  eraReleases: ArtistEraRelease[]
  eraCount: number
  catalogCount: number
  /** True when the catalog was too large to sweep completely. */
  truncated: boolean
}

export async function fetchArtistEra(
  mbid: string,
  yearStart: number,
  yearEnd: number,
  signal: AbortSignal,
): Promise<ArtistEraDetails> {
  const span =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}-${yearEnd}`
  const res = await resilientFetch(
    `artist-era ${mbid.slice(0, 8)}/${span}`,
    `/api/explore/artist-era/${mbid}/${span}`,
    signal,
  )
  if (res.status === 429) {
    throw new Error('MusicBrainz is busy right now — try again in a moment.')
  }
  if (!res.ok) {
    throw new Error("Could not load this artist's era catalog.")
  }
  return res.json()
}

/**
 * The caller's abort combined with a hard client deadline: a wedged
 * request can never leave a panel spinning forever — it surfaces as a
 * retryable error instead.
 */
const PANEL_TIMEOUT_MS = 30_000
/** One silent retry before surfacing an error — flaky-LTE insurance. */
const AUTO_RETRY_DELAY_MS = 1200

function deadline(signal: AbortSignal, ms = PANEL_TIMEOUT_MS): AbortSignal {
  // AbortSignal.any needs Safari 17.4+ / timeout needs 16+. On older
  // iOS (the iPhone 12 field failure: EVERY tap threw a TypeError
  // instantly, read as a network error) fall back to a manual combo.
  if (
    typeof AbortSignal.any === 'function' &&
    typeof AbortSignal.timeout === 'function'
  ) {
    return AbortSignal.any([signal, AbortSignal.timeout(ms)])
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer)
      controller.abort()
    },
    { once: true },
  )
  return controller.signal
}

const TIMEOUT_MESSAGE =
  'That took too long — MusicBrainz may be busy. Try again, or narrow the era.'
const NETWORK_MESSAGE =
  'The connection dropped before an answer arrived — check your signal and try again.'

/**
 * Runs a panel fetch with one silent retry, distinguishes a genuine
 * timeout from a connection drop, and beacons the failure (with real
 * elapsed timing) so field failures on other people's devices stop
 * being guesswork.
 */
async function resilientFetch(
  label: string,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const started = Date.now()
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetch(url, { signal: deadline(signal) })
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
      if (attempt === 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTO_RETRY_DELAY_MS),
        )
        if (signal.aborted) throw error
      }
    }
  }
  const elapsed = Date.now() - started
  const timedOut = elapsed >= PANEL_TIMEOUT_MS
  // Fire-and-forget: the user's error must never wait on (or be broken
  // by) the reporting path — a blocked beacon is nobody's problem.
  import('@/lib/clientLog')
    .then(({ reportClientError }) =>
      reportClientError(
        'panel-fetch',
        `${label} failed after 2 attempts (${elapsed}ms, ${timedOut ? 'timeout' : 'network'})`,
        lastError,
      ),
    )
    .catch(() => {})
  throw new Error(timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE)
}

export async function fetchCountryYearDetails(
  country: string,
  yearStart: number,
  yearEnd: number,
  genre: string | null,
  signal: AbortSignal,
): Promise<CountryYearDetails> {
  const span =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}-${yearEnd}`
  const genreQuery = genre ? `?genre=${encodeURIComponent(genre)}` : ''
  const res = await resilientFetch(
    `country ${country}/${span}${genre ? `?g=${genre}` : ''}`,
    `/api/explore/${country}/${span}${genreQuery}`,
    signal,
  )
  if (res.status === 429) {
    throw new Error('MusicBrainz is busy right now — try again in a moment.')
  }
  if (!res.ok) {
    throw new Error('Could not load releases for this country.')
  }
  return res.json()
}
