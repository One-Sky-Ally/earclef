import { NextResponse } from 'next/server'
import type {
  CountryYearDetails,
  PanelArtist,
  PanelRelease,
} from '@/lib/explore/panelData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'
const RELEASE_LIMIT = 30
const ARTIST_LIMIT = 12
/**
 * Origin-artist sweep: two pages of 100. MusicBrainz row order for
 * filter queries roughly tracks registration age, and famous artists
 * were catalogued earliest, so the significant names live in the first
 * pages; tag-weight ranking cleans up the order.
 */
const ORIGIN_PAGE_SIZE = 100
const ORIGIN_PAGES = 2
const ORIGIN_LIMIT = 12
const MB_DELAY_MS = 1100

// Warm-process memoization; the CDN Cache-Control header does the real work.
const memo = new Map<string, CountryYearDetails>()

interface MbArtistCredit {
  artist?: { id: string; name: string }
}

interface MbRelease {
  id: string
  title: string
  date?: string
  'artist-credit'?: MbArtistCredit[]
}

interface MbArtist {
  id: string
  name: string
  type?: string
  'life-span'?: { begin?: string }
  tags?: { count?: number; name?: string }[]
}

/**
 * For people, MusicBrainz "begin" is the BIRTH date — a newborn isn't
 * active. Treat a person's career as starting ~15 years after birth so
 * Sean Paul (b. 1973) stops appearing in Jamaica 1969–1975. Groups use
 * their formation date as-is.
 */
const PERSON_CAREER_OFFSET_YEARS = 15

function activeByRangeEnd(artist: MbArtist, rangeEnd: number): boolean {
  const beginYear = Number(artist['life-span']?.begin?.slice(0, 4))
  if (!Number.isFinite(beginYear)) return true
  const careerStart =
    artist.type === 'Person'
      ? beginYear + PERSON_CAREER_OFFSET_YEARS
      : beginYear
  return careerStart <= rangeEnd
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One MusicBrainz GET with a single backoff retry on 429/503. */
async function mbJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.status === 503 || res.status === 429) {
      if (attempt === 1) {
        await sleep(1200)
        continue
      }
      throw new RateLimitError()
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
    return res.json()
  }
  throw new Error('Unreachable')
}

class RateLimitError extends Error {}

/**
 * Artists whose MusicBrainz ORIGIN is this country and whose life-span
 * overlaps the range, ranked by tag richness (tag vote counts come free
 * in the search response — Björk carries hundreds, a one-compilation
 * band carries none). Returns the ranked top plus the full id set for
 * re-ranking releases. Failures degrade to empty — the panel still works.
 */
async function fetchOriginArtists(
  country: string,
  start: number,
  end: number,
): Promise<{ top: PanelArtist[]; ids: Set<string> }> {
  // Active in range: began by the range's end, didn't end before its start.
  // (For people MB's "begin" is the birth date — a coarse but honest proxy.)
  const query = encodeURIComponent(
    `country:${country} AND begin:[* TO ${end}] AND NOT end:[* TO ${start - 1}]`,
  )

  const weighted: { artist: PanelArtist; weight: number }[] = []
  const ids = new Set<string>()
  try {
    for (let page = 0; page < ORIGIN_PAGES; page++) {
      const body = (await mbJson(
        `https://musicbrainz.org/ws/2/artist?query=${query}&limit=${ORIGIN_PAGE_SIZE}&offset=${page * ORIGIN_PAGE_SIZE}&fmt=json`,
      )) as { count?: number; artists?: MbArtist[] }
      for (const artist of body.artists ?? []) {
        if (ids.has(artist.id) || !activeByRangeEnd(artist, end)) continue
        ids.add(artist.id)
        const weight = (artist.tags ?? []).reduce(
          (sum, tag) => sum + (tag.count ?? 0),
          0,
        )
        weighted.push({
          artist: { id: artist.id, name: artist.name },
          weight,
        })
      }
      if ((body.count ?? 0) <= (page + 1) * ORIGIN_PAGE_SIZE) break
      await sleep(MB_DELAY_MS)
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error
    console.error(`origin artists ${country} failed:`, error)
    return { top: [], ids: new Set() }
  }

  const top = weighted
    .sort((a, b) => b.weight - a.weight)
    .slice(0, ORIGIN_LIMIT)
    .map((entry) => entry.artist)
  return { top, ids }
}

function toDetails(
  body: { count?: number; releases?: MbRelease[] },
  origin: { top: PanelArtist[]; ids: Set<string> },
): CountryYearDetails {
  const releases: PanelRelease[] = []
  const artistById = new Map<string, PanelArtist>()

  for (const release of body.releases ?? []) {
    const artist = release['artist-credit']?.[0]?.artist
    if (!artist) continue
    if (!artistById.has(artist.id) && artistById.size < ARTIST_LIMIT) {
      artistById.set(artist.id, { id: artist.id, name: artist.name })
    }
    releases.push({
      id: release.id,
      title: release.title,
      date: release.date,
      artist: { id: artist.id, name: artist.name },
    })
  }

  // Releases by artists FROM this country outrank foreign pressings;
  // chronological within each group.
  const sorted = [...releases].sort((a, b) => {
    const aOrigin = origin.ids.has(a.artist.id)
    const bOrigin = origin.ids.has(b.artist.id)
    if (aOrigin !== bOrigin) return aOrigin ? -1 : 1
    return (a.date ?? '9999').localeCompare(b.date ?? '9999')
  })

  return {
    totalCount: body.count ?? 0,
    originArtists: origin.top,
    artists: [...artistById.values()],
    releases: sorted,
  }
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ country: string; year: string }> },
) {
  const { country, year } = await ctx.params

  // "1969" (single year) or "1965-1975" (inclusive span).
  if (!/^[A-Z]{2}$/.test(country) || !/^\d{4}(-\d{4})?$/.test(year)) {
    return NextResponse.json({ error: 'Invalid country or year' }, { status: 400 })
  }
  const [startRaw, endRaw = startRaw] = year.split('-')
  const start = Number(startRaw)
  const end = Number(endRaw)
  if (start < 1900 || end > 2100 || start > end) {
    return NextResponse.json({ error: 'Year out of range' }, { status: 400 })
  }

  const key = `${country}:${year}`
  const cached = memo.get(key)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  const releaseQuery = encodeURIComponent(
    `country:${country} AND date:[${start} TO ${end}-12-31]`,
  )

  try {
    const releasesBody = (await mbJson(
      `https://musicbrainz.org/ws/2/release?query=${releaseQuery}&limit=${RELEASE_LIMIT}&fmt=json`,
    )) as { count?: number; releases?: MbRelease[] }
    await sleep(MB_DELAY_MS)
    const origin = await fetchOriginArtists(country, start, end)

    const details = toDetails(releasesBody, origin)
    memo.set(key, details)
    return withCacheHeaders(NextResponse.json(details))
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'MusicBrainz rate limit' },
        { status: 429 },
      )
    }
    console.error(`explore api ${key} failed:`, error)
    return NextResponse.json(
      { error: 'MusicBrainz unavailable' },
      { status: 502 },
    )
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
