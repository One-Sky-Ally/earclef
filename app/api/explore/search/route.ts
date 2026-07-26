import { NextResponse } from 'next/server'
import { subdivisionByName } from '@/lib/explore/subdivisions'
import type { SearchResult } from '@/lib/explore/panelData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const MAX_PARENT_HOPS = 4
/** Artist fallback only fires on confident matches — typo'd place
 * names shouldn't resolve to whoever scores highest. */
const ARTIST_MIN_SCORE = 85

const memo = new Map<string, SearchResult | null>()

interface MbArea {
  id: string
  name: string
  score?: number
  'iso-3166-1-codes'?: string[]
  relations?: {
    type: string
    direction?: string
    area?: MbArea
  }[]
}

/** MusicBrainz normalizes top-hit scores, so "Aphex Twin" surfaces the
 * area "Twin" at full confidence. A place search is always the place's
 * own name — require normalized equality; everything else falls
 * through to the artist lookup. */
function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function mbFetch(url: string): Promise<Response> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if ((res.status === 503 || res.status === 429) && attempt === 1) {
      await sleep(1200)
      continue
    }
    return res
  }
  throw new Error('unreachable')
}

function countryCodeOf(area: MbArea): string | undefined {
  return area['iso-3166-1-codes']?.[0]
}

/** Walk "part of" relations upward until an area carries a country code. */
async function resolveCountry(area: MbArea): Promise<string | undefined> {
  let current = area
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    const direct = countryCodeOf(current)
    if (direct) return direct

    await sleep(1050)
    const res = await mbFetch(
      `https://musicbrainz.org/ws/2/area/${current.id}?inc=area-rels&fmt=json`,
    )
    if (!res.ok) return undefined
    const body = (await res.json()) as MbArea

    const partOf = (body.relations ?? []).filter(
      (rel) => rel.type === 'part of' && rel.area,
    )
    const withCode = partOf.find((rel) => countryCodeOf(rel.area!))
    const parent =
      withCode?.area ??
      partOf.find((rel) => rel.direction === 'backward')?.area ??
      partOf[0]?.area
    if (!parent) return undefined
    current = parent
  }
  return undefined
}

interface MbArtistHit {
  id: string
  name: string
  score?: number
}

/** Confident artist match for the fallback, or null. Throws on MB
 * failure so a transient outage never memoizes as a permanent miss. */
async function findArtist(query: string): Promise<SearchResult | null> {
  const res = await mbFetch(
    `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&limit=3&fmt=json`,
  )
  if (!res.ok) throw new Error(`artist search HTTP ${res.status}`)
  const body = (await res.json()) as { artists?: MbArtistHit[] }
  const top = body.artists?.[0]
  if (!top || (top.score ?? 0) < ARTIST_MIN_SCORE) return null
  return { kind: 'artist', artist: { mbid: top.id, name: top.name } }
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  const key = query.toLowerCase()
  if (memo.has(key)) {
    const cached = memo.get(key)
    return cached
      ? withCacheHeaders(NextResponse.json(cached))
      : withCacheHeaders(
          NextResponse.json({ error: 'No match' }, { status: 404 }),
        )
  }

  // Configured subdivisions win by name — "Hawaii" opens US-HI, not US.
  const subdivision = subdivisionByName(query)
  if (subdivision) {
    const result: SearchResult = {
      kind: 'place',
      country: subdivision.code,
      area: subdivision.name,
    }
    memo.set(key, result)
    return withCacheHeaders(NextResponse.json(result))
  }

  try {
    const res = await mbFetch(
      `https://musicbrainz.org/ws/2/area?query=${encodeURIComponent(query)}&limit=5&fmt=json`,
    )
    if (res.status === 503 || res.status === 429) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

    const body = (await res.json()) as { areas?: MbArea[] }
    const top = body.areas?.find(
      (area) => normalizedName(area.name) === normalizedName(query),
    )
    const country = top ? await resolveCountry(top) : undefined

    if (top && country) {
      const result: SearchResult = { kind: 'place', country, area: top.name }
      memo.set(key, result)
      return withCacheHeaders(NextResponse.json(result))
    }

    // No place matched — maybe it's an artist ("what did they put out
    // in this era?" is answered by the artist-era panel client-side).
    await sleep(1050)
    const artist = await findArtist(query)
    memo.set(key, artist)
    return artist
      ? withCacheHeaders(NextResponse.json(artist))
      : withCacheHeaders(
          NextResponse.json({ error: 'No match' }, { status: 404 }),
        )
  } catch (error) {
    console.error(`explore search "${query}" failed:`, error)
    return NextResponse.json({ error: 'Search unavailable' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  // Netlify's CDN ignores query strings in function cache keys unless
  // told otherwise — without this, the first cached search is served
  // for EVERY query (the "everything resolves to Iceland" bug).
  response.headers.set('Netlify-Vary', 'query=q')
  return response
}
