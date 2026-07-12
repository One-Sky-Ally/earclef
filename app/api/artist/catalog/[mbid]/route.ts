import { NextResponse } from 'next/server'
import type {
  BrowserCategory,
  CatalogItem,
  CatalogResponse,
} from '@/lib/artist/browserData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PAGE_SIZE = 100
const MAX_ITEMS = 600

const memo = new Map<string, CatalogResponse>()

interface MbReleaseGroup {
  id: string
  title: string
  'first-release-date'?: string
  'primary-type'?: string
  'secondary-types'?: string[]
}

const CATEGORY_LABELS: Record<string, string> = {
  albums: 'Albums',
  eps: 'EPs',
  singles: 'Singles',
  live: 'Live',
  compilations: 'Compilations & B-sides',
  remixes: 'Remixes',
  other: 'Other',
}

function categoryOf(rg: MbReleaseGroup): string {
  const secondary = rg['secondary-types'] ?? []
  if (secondary.includes('Live')) return 'live'
  if (secondary.includes('Remix') || secondary.includes('DJ-mix')) {
    return 'remixes'
  }
  if (secondary.includes('Compilation')) return 'compilations'
  switch (rg['primary-type']) {
    case 'Album':
      return 'albums'
    case 'EP':
      return 'eps'
    case 'Single':
      return 'singles'
    default:
      return 'other'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function mbFetch(url: string): Promise<Response> {
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if ((res.status === 503 || res.status === 429) && attempt < MAX_ATTEMPTS) {
        await sleep(1500 * attempt)
        continue
      }
      return res
    } catch (error) {
      // Network-level failure (timeout, reset) — retry with backoff.
      if (attempt === MAX_ATTEMPTS) throw error
      await sleep(1500 * attempt)
    }
  }
  throw new Error('unreachable')
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ mbid: string }> },
) {
  const { mbid } = await ctx.params
  if (!UUID_PATTERN.test(mbid)) {
    return NextResponse.json({ error: 'Invalid MBID' }, { status: 400 })
  }

  const cached = memo.get(mbid)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  try {
    const groups: MbReleaseGroup[] = []
    for (let offset = 0; offset < MAX_ITEMS; offset += PAGE_SIZE) {
      const res = await mbFetch(
        `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=${PAGE_SIZE}&offset=${offset}&fmt=json`,
      )
      if (res.status === 503 || res.status === 429) {
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
      const body = (await res.json()) as {
        'release-group-count': number
        'release-groups': MbReleaseGroup[]
      }
      groups.push(...body['release-groups'])
      if (offset + PAGE_SIZE >= body['release-group-count']) break
      await sleep(1100)
    }

    const buckets = new Map<string, CatalogItem[]>()
    for (const rg of groups) {
      const key = categoryOf(rg)
      const list = buckets.get(key) ?? []
      list.push({
        rgid: rg.id,
        title: rg.title,
        year: rg['first-release-date']?.slice(0, 4) || undefined,
      })
      buckets.set(key, list)
    }

    const categories: BrowserCategory<CatalogItem>[] = Object.keys(
      CATEGORY_LABELS,
    )
      .filter((key) => buckets.has(key))
      .map((key) => ({
        key,
        label: CATEGORY_LABELS[key],
        items: [...buckets.get(key)!].sort((a, b) =>
          (b.year ?? '0000').localeCompare(a.year ?? '0000'),
        ),
      }))

    const response: CatalogResponse = { categories }
    memo.set(mbid, response)
    return withCacheHeaders(NextResponse.json(response))
  } catch (error) {
    console.error(`catalog ${mbid} failed:`, error)
    return NextResponse.json({ error: 'Catalog unavailable' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
