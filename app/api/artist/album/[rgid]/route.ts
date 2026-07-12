import { NextResponse } from 'next/server'
import type { AlbumDetails } from '@/lib/artist/browserData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const memo = new Map<string, AlbumDetails>()

interface MbTrack {
  title: string
  position: number
}

interface MbRelease {
  media?: { tracks?: MbTrack[] }[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ rgid: string }> },
) {
  const { rgid } = await ctx.params
  if (!UUID_PATTERN.test(rgid)) {
    return NextResponse.json({ error: 'Invalid release group' }, { status: 400 })
  }

  const cached = memo.get(rgid)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res: Response
      try {
        res = await fetch(
          `https://musicbrainz.org/ws/2/release?release-group=${rgid}&status=official&limit=1&inc=recordings&fmt=json`,
          { headers: { 'User-Agent': USER_AGENT } },
        )
      } catch (error) {
        if (attempt === 3) throw error
        await sleep(1500 * attempt)
        continue
      }
      if (res.status === 503 || res.status === 429) {
        if (attempt < 3) {
          await sleep(1500 * attempt)
          continue
        }
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

      const body = (await res.json()) as { releases?: MbRelease[] }
      const tracks = (body.releases?.[0]?.media ?? [])
        .flatMap((medium) => medium.tracks ?? [])
        .sort((a, b) => a.position - b.position)
        .map((track) => track.title)

      const details: AlbumDetails = { tracks }
      memo.set(rgid, details)
      return withCacheHeaders(NextResponse.json(details))
    }
    return NextResponse.json({ error: 'Unreachable' }, { status: 500 })
  } catch (error) {
    console.error(`album ${rgid} failed:`, error)
    return NextResponse.json({ error: 'Album unavailable' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
