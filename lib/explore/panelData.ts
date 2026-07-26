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

export interface CountryYearDetails {
  totalCount: number
  /**
   * Artists whose MusicBrainz origin is this country, active in the
   * range, ranked by significance — shown before the pressing-derived
   * results. Empty when the origin lookup found nothing (or failed).
   */
  originArtists: PanelArtist[]
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
  const res = await fetch(
    `/api/explore/search?q=${encodeURIComponent(query)}`,
    { signal },
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
  const res = await fetch(`/api/explore/artist-era/${mbid}/${span}`, {
    signal,
  })
  if (res.status === 429) {
    throw new Error('MusicBrainz is busy right now — try again in a moment.')
  }
  if (!res.ok) {
    throw new Error("Could not load this artist's era catalog.")
  }
  return res.json()
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
  const res = await fetch(`/api/explore/${country}/${span}${genreQuery}`, {
    signal,
  })
  if (res.status === 429) {
    throw new Error('MusicBrainz is busy right now — try again in a moment.')
  }
  if (!res.ok) {
    throw new Error('Could not load releases for this country.')
  }
  return res.json()
}
