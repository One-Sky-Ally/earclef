import { NextResponse } from 'next/server'
import type {
  ItunesRelease,
  ItunesReleasesResponse,
} from '@/lib/artist/browserData'

const ID_PATTERN = /^\d{1,12}$/
const MEMO_TTL_MS = 60 * 60 * 1000

const memo = new Map<string, { response: ItunesReleasesResponse; at: number }>()

interface ItunesCollection {
  wrapperType?: string
  collectionName?: string
  releaseDate?: string
  artworkUrl100?: string
}

/** Apple appends " - Single" / " - EP" to collection names. */
function cleanTitle(name: string): string {
  return name.replace(/ - (Single|EP)$/i, '')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ itunesId: string }> },
) {
  const { itunesId } = await ctx.params
  if (!ID_PATTERN.test(itunesId)) {
    return NextResponse.json({ error: 'Invalid artist id' }, { status: 400 })
  }

  const cached = memo.get(itunesId)
  if (cached && Date.now() - cached.at < MEMO_TTL_MS) {
    return withCacheHeaders(NextResponse.json(cached.response))
  }

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response
      try {
        res = await fetch(
          `https://itunes.apple.com/lookup?id=${itunesId}&entity=album&limit=200&sort=recent`,
          { headers: { 'User-Agent': 'EarClef/0.1 (https://earclef.netlify.app)' } },
        )
      } catch (error) {
        if (attempt === 2) throw error
        await sleep(1500)
        continue
      }
      if (res.status === 403 || res.status === 429) {
        // iTunes Search API throttles ~20 req/min per IP.
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`)

      const body = (await res.json()) as { results?: ItunesCollection[] }
      const items: ItunesRelease[] = (body.results ?? [])
        .filter(
          (result) =>
            result.wrapperType === 'collection' &&
            result.collectionName &&
            result.releaseDate,
        )
        .map((result) => ({
          title: cleanTitle(result.collectionName!),
          date: result.releaseDate!.slice(0, 10),
          image: result.artworkUrl100,
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 60)

      const response: ItunesReleasesResponse = { items }
      memo.set(itunesId, { response, at: Date.now() })
      return withCacheHeaders(NextResponse.json(response))
    }
    return NextResponse.json({ error: 'Unreachable' }, { status: 500 })
  } catch (error) {
    console.error(`itunes releases ${itunesId} failed:`, error)
    return NextResponse.json({ error: 'Unavailable' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  )
  return response
}
