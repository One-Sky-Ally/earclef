import { NextResponse } from 'next/server'
import { getStore } from '@netlify/blobs'
import { isGenreLens } from '@/lib/explore/genreData'
import {
  SUBDIVISION_CODE_PATTERN,
  subdivisionByCode,
} from '@/lib/explore/subdivisions'
import { REGION_CODE_PATTERN, regionByCode } from '@/lib/explore/states'
import { movedIn, movedOut } from '@/lib/explore/originCorrections'
import { hasStateData, stateDetails } from '@/lib/explore/stateData'
import { extraArtistGroupsFor } from '@/lib/explore/extraArtistsServer'
import type {
  CountryYearDetails,
  PanelArtist,
  PanelRelease,
  PoolArtist,
} from '@/lib/explore/panelData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
// One page of 100 costs the same single MB request as 30 did, and it
// feeds the credits list enough distinct artists for tiered digging.
const RELEASE_LIMIT = 100
const ORIGIN_LIMIT = 12
/** Credited-artist cap — matches the panel's 100-pill render cap. */
const CREDIT_LIMIT = 100
/**
 * Origin-artist sweep: two pages of 100. MusicBrainz row order for
 * filter queries roughly tracks registration age, and famous artists
 * were catalogued earliest, so the significant names live in the first
 * pages; tag-weight ranking cleans up the order.
 */
const ORIGIN_PAGE_SIZE = 100
const ORIGIN_PAGES = 2
/** Discovery-pool cap shipped to the panel (tiers/chips/search). */
const POOL_LIMIT = 300
/** Tags kept per pool artist — enough for a genre fingerprint. */
const POOL_TAG_LIMIT = 4
const MB_DELAY_MS = 1100

// Warm-process memoization; the CDN Cache-Control header does the real work.
const memo = new Map<string, CountryYearDetails>()

/**
 * Blobs read-through cache: once ANY instance has computed a combo, no
 * visitor ever waits on the MusicBrainz fan-out for it again — cold
 * starts and CDN cache misses included. Slow-connection insurance: the
 * repeat query that used to hold a connection for 5–20s answers in
 * milliseconds. Historical data barely moves; entries refresh after 30
 * days. Failures fall through to the live path silently.
 */
const BLOB_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface CachedDetails {
  at: string
  details: CountryYearDetails
}

function blobStore() {
  return getStore({ name: 'explore', consistency: 'eventual' })
}

// v3: credits list grew 12 → 100 (ranked by credit count, from a full
// 100-release page). Key bumps make hot combos recompute instead of
// serving the old shape for 30 days; stale-version entries age out.
const BLOB_KEY_PREFIX = 'panel/v3/'

async function readCached(key: string): Promise<CountryYearDetails | null> {
  try {
    const entry = (await blobStore().get(`${BLOB_KEY_PREFIX}${key}`, {
      type: 'json',
    })) as CachedDetails | null
    if (!entry) return null
    if (Date.now() - Date.parse(entry.at) > BLOB_TTL_MS) return null
    return entry.details
  } catch {
    return null
  }
}

async function writeCached(
  key: string,
  details: CountryYearDetails,
): Promise<void> {
  try {
    await blobStore().setJSON(`${BLOB_KEY_PREFIX}${key}`, {
      at: new Date().toISOString(),
      details,
    } satisfies CachedDetails)
  } catch {
    // Cache writes are best-effort.
  }
}

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

/**
 * One MusicBrainz GET; backoff-retries rate limits AND network drops.
 * Each request carries a hard deadline — a hanging upstream must fail
 * fast enough for the route to answer inside the function budget,
 * so the client always gets a real error instead of a dead connection.
 */
const MB_REQUEST_TIMEOUT_MS = 8000

async function mbJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(MB_REQUEST_TIMEOUT_MS),
      })
      if (res.status === 503 || res.status === 429) {
        if (attempt < 3) {
          await sleep(1500 * attempt)
          continue
        }
        throw new RateLimitError()
      }
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
      return res.json()
    } catch (error) {
      if (error instanceof RateLimitError) throw error
      if (attempt === 3) throw error
      await sleep(1500 * attempt)
    }
  }
  throw new Error('Unreachable')
}

class RateLimitError extends Error {}

/**
 * Artists whose MusicBrainz ORIGIN is this country and whose life-span
 * overlaps the range, ranked by tag richness (tag vote counts come free
 * in the search response — Björk carries hundreds, a one-compilation
 * band carries none). Returns the ranked top plus the full id set for
 * re-ranking releases. Returns null on failure — callers must never
 * cache a failure as an empty result.
 */
async function fetchOriginArtists(
  originClause: string,
  start: number,
  end: number,
  genre: string | null,
  /**
   * Set for country pools so origin corrections apply: MusicBrainz's
   * `country:` field follows residence/citizenship, not where the
   * music began. Null for subdivision (area-name) pools, which are
   * already begin-area based.
   */
  correctFor: string | null = null,
): Promise<{
  top: PanelArtist[]
  pool: PoolArtist[]
  ids: Set<string>
  count: number
} | null> {
  // Active in range: began by the range's end, didn't end before its start.
  // (For people MB's "begin" is the birth date — a coarse but honest proxy.)
  const genreClause = genre ? ` AND tag:"${genre}"` : ''
  const query = encodeURIComponent(
    `${originClause} AND begin:[* TO ${end}] AND NOT end:[* TO ${start - 1}]${genreClause}`,
  )

  // Genre sweeps hit the largest result sets (electronic: 12k+ US
  // artists) — one page of 100 is plenty for a ranked top-12 and keeps
  // the worst case well inside the function budget.
  const pages = genre ? 1 : ORIGIN_PAGES

  const weighted: { artist: PoolArtist; weight: number }[] = []
  const ids = new Set<string>()
  let count = 0
  try {
    for (let page = 0; page < pages; page++) {
      const body = (await mbJson(
        `https://musicbrainz.org/ws/2/artist?query=${query}&limit=${ORIGIN_PAGE_SIZE}&offset=${page * ORIGIN_PAGE_SIZE}&fmt=json`,
      )) as { count?: number; artists?: MbArtist[] }
      count = body.count ?? 0
      for (const artist of body.artists ?? []) {
        if (ids.has(artist.id) || !activeByRangeEnd(artist, end)) continue
        ids.add(artist.id)
        const tags = (artist.tags ?? []).filter((tag) => (tag.count ?? 0) > 0)
        weighted.push({
          artist: {
            id: artist.id,
            name: artist.name,
            tags: tags
              .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
              .slice(0, POOL_TAG_LIMIT)
              .flatMap((tag) => (tag.name ? [tag.name] : [])),
          },
          weight: tags.reduce((sum, tag) => sum + (tag.count ?? 0), 0),
        })
      }
      if ((body.count ?? 0) <= (page + 1) * ORIGIN_PAGE_SIZE) break
      await sleep(MB_DELAY_MS)
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error
    console.error(`origin artists ${originClause} failed:`, error)
    return null
  }

  // Residence ≠ origin: drop artists this country only hosts, and
  // claim the ones whose music actually began here.
  if (correctFor) {
    const leaving = movedOut(correctFor)
    if (leaving.size > 0) {
      for (let i = weighted.length - 1; i >= 0; i--) {
        if (leaving.has(weighted[i].artist.id)) {
          ids.delete(weighted[i].artist.id)
          weighted.splice(i, 1)
          count = Math.max(0, count - 1)
        }
      }
    }
    for (const arrival of movedIn(
      correctFor,
      start,
      end,
      PERSON_CAREER_OFFSET_YEARS,
    )) {
      if (ids.has(arrival.artist.id)) continue
      if (genre && !arrival.artist.tags.includes(genre)) continue
      ids.add(arrival.artist.id)
      weighted.push(arrival)
      count++
    }
  }

  const sorted = weighted.sort((a, b) => b.weight - a.weight)
  const top = sorted
    .slice(0, ORIGIN_LIMIT)
    .map((entry) => ({ id: entry.artist.id, name: entry.artist.name }))
  const pool = sorted.slice(0, POOL_LIMIT).map((entry) => entry.artist)
  return { top, pool, ids, count }
}

function toDetails(
  body: { count?: number; releases?: MbRelease[] },
  origin: { top: PanelArtist[]; pool: PoolArtist[]; ids: Set<string> },
): CountryYearDetails {
  const releases: PanelRelease[] = []
  // Release credits carry no tags, so the credits list ranks by the
  // best signal this surface has: how many issued-here releases an
  // artist is credited on (ties keep first-seen order).
  const credited = new Map<string, { artist: PanelArtist; credits: number }>()

  for (const release of body.releases ?? []) {
    const artist = release['artist-credit']?.[0]?.artist
    if (!artist) continue
    const entry = credited.get(artist.id)
    if (entry) {
      entry.credits++
    } else {
      credited.set(artist.id, {
        artist: { id: artist.id, name: artist.name },
        credits: 1,
      })
    }
    releases.push({
      id: release.id,
      title: release.title,
      date: release.date,
      artist: { id: artist.id, name: artist.name },
    })
  }
  const artistById = new Map(
    [...credited.entries()]
      .sort((a, b) => b[1].credits - a[1].credits)
      .slice(0, CREDIT_LIMIT)
      .map(([id, entry]) => [id, entry.artist]),
  )

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
    panelArtists: origin.pool,
    artists: [...artistById.values()],
    releases: sorted,
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ country: string; year: string }> },
) {
  const { country, year } = await ctx.params
  const genreParam = new URL(request.url).searchParams.get('genre')
  const genre = isGenreLens(genreParam) ? genreParam : null
  if (genreParam && !genre) {
    return NextResponse.json({ error: 'Unknown genre' }, { status: 400 })
  }

  // "1969" (single year) or "1965-1975" (inclusive span).
  const region = REGION_CODE_PATTERN.test(country)
    ? regionByCode(country)
    : undefined
  // Regions without committed data (a US state or UK nation whose
  // precompute hasn't landed, and any future non-region subdivision)
  // fall back to the live MusicBrainz area query, Hawaii-style.
  const subdivision =
    !region && SUBDIVISION_CODE_PATTERN.test(country)
      ? subdivisionByCode(country)
      : region && !hasStateData(region.code)
        ? { code: region.code, mbArea: region.name }
        : undefined
  if (
    (!/^[A-Z]{2}$/.test(country) && !subdivision && !region) ||
    !/^\d{4}(-\d{4})?$/.test(year)
  ) {
    return NextResponse.json({ error: 'Invalid country or year' }, { status: 400 })
  }
  const [startRaw, endRaw = startRaw] = year.split('-')
  const start = Number(startRaw)
  const end = Number(endRaw)
  if (start < 1900 || end > 2100 || start > end) {
    return NextResponse.json({ error: 'Year out of range' }, { status: 400 })
  }

  // Gap-fill entries attach at RESPONSE time, never into memo/Blobs —
  // stored payloads stay MB-only, so dataset updates reach cached
  // panels on the next deploy (which purges the CDN) without a cache
  // version bump. The client receives shaped entries; the dataset
  // itself never enters a browser bundle (Aug 2026 bandwidth lesson).
  const respond = (details: CountryYearDetails) =>
    withCacheHeaders(
      NextResponse.json({
        ...details,
        extraArtists: extraArtistGroupsFor(country, start, end),
      }),
    )

  // Region panels answer from the committed dataset — no MusicBrainz,
  // no Blobs, milliseconds for any span. Deploys refresh the data and
  // purge the CDN together.
  if (region && hasStateData(region.code)) {
    const details = stateDetails(region.code, start, end, genre)
    if (details) return withCacheHeaders(NextResponse.json(details))
  }

  const key = `${country}:${year}:${genre ?? ''}`
  const cached = memo.get(key)
  if (cached) return respond(cached)

  const blobCached = await readCached(key)
  if (blobCached) {
    memo.set(key, blobCached)
    return respond(blobCached)
  }

  const releaseQuery = encodeURIComponent(
    `country:${country} AND date:[${start} TO ${end}-12-31]`,
  )

  // Countries filter artists by ISO code; subdivisions by MB area name
  // (quoted — "Hawaii" the area, not a name fragment).
  const originClause = subdivision
    ? `area:"${subdivision.mbArea}"`
    : `country:${country}`

  try {
    // Lens mode and subdivisions are artists-only: release tags are too
    // sparse to filter honestly, and MB pressing data is country-level.
    if (genre || subdivision) {
      const origin = await fetchOriginArtists(
        originClause,
        start,
        end,
        genre,
        subdivision ? null : country,
      )
      if (!origin) {
        return NextResponse.json(
          { error: 'MusicBrainz unavailable' },
          { status: 502 },
        )
      }
      const details: CountryYearDetails = {
        totalCount: origin.count,
        originArtists: origin.top,
        panelArtists: origin.pool,
        artists: [],
        releases: [],
      }
      memo.set(key, details)
      await writeCached(key, details)
      return respond(details)
    }

    const releasesBody = (await mbJson(
      `https://musicbrainz.org/ws/2/release?query=${releaseQuery}&limit=${RELEASE_LIMIT}&fmt=json`,
    )) as { count?: number; releases?: MbRelease[] }
    await sleep(MB_DELAY_MS)
    const origin = await fetchOriginArtists(
      originClause,
      start,
      end,
      null,
      subdivision ? null : country,
    )

    if (!origin) {
      // Serve a degraded (origin-less) panel, but never cache it — a
      // transient failure must not become the 30-day cached answer.
      const degraded = toDetails(releasesBody, {
        top: [],
        pool: [],
        ids: new Set(),
      })
      const response = NextResponse.json(degraded)
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const details = toDetails(releasesBody, origin)
    memo.set(key, details)
    await writeCached(key, details)
    return respond(details)
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
  // The genre lens rides a query param — without this the CDN would
  // serve one cached panel for every genre (see the search-route bug).
  response.headers.set('Netlify-Vary', 'query=genre')
  return response
}
