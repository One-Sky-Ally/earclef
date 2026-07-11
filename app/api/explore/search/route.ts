import { NextResponse } from 'next/server'
import type { PlaceResult } from '@/lib/explore/panelData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'
const MAX_PARENT_HOPS = 4

const memo = new Map<string, PlaceResult | null>()

interface MbArea {
  id: string
  name: string
  'iso-3166-1-codes'?: string[]
  relations?: {
    type: string
    direction?: string
    area?: MbArea
  }[]
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

  try {
    const res = await mbFetch(
      `https://musicbrainz.org/ws/2/area?query=${encodeURIComponent(query)}&limit=5&fmt=json`,
    )
    if (res.status === 503 || res.status === 429) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

    const body = (await res.json()) as { areas?: MbArea[] }
    const top = body.areas?.[0]
    if (!top) {
      memo.set(key, null)
      return withCacheHeaders(
        NextResponse.json({ error: 'No match' }, { status: 404 }),
      )
    }

    const country = await resolveCountry(top)
    if (!country) {
      memo.set(key, null)
      return withCacheHeaders(
        NextResponse.json({ error: 'No match' }, { status: 404 }),
      )
    }

    const result: PlaceResult = { country, area: top.name }
    memo.set(key, result)
    return withCacheHeaders(NextResponse.json(result))
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
  return response
}
