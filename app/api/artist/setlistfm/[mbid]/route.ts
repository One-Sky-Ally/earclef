import { NextResponse } from 'next/server'
import { setlistFmArtistUrl } from '@/lib/artist/setlistfm'

/**
 * The artist's own setlist.fm page, from MusicBrainz's url relations for
 * their MBID: `{url}` when MusicBrainz lists exactly one, `{url: null}`
 * when it lists none (the page then offers a labelled search). Errors
 * are errors, not "none" — the client falls back to the search either
 * way, but only a real answer is cached.
 */

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Warm-process memoization; the CDN Cache-Control header does the real work.
const memo = new Map<string, string | null>()

function answer(url: string | null): NextResponse {
  const response = NextResponse.json({ url })
  // A found page is stable; a missing one is re-asked daily so a link
  // added on MusicBrainz shows up soon.
  response.headers.set(
    'Cache-Control',
    url
      ? 'public, s-maxage=2592000, stale-while-revalidate=604800'
      : 'public, s-maxage=86400, stale-while-revalidate=86400',
  )
  return response
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ mbid: string }> },
) {
  const { mbid } = await ctx.params
  if (!UUID.test(mbid)) {
    return NextResponse.json({ error: 'Invalid artist id' }, { status: 400 })
  }
  if (memo.has(mbid)) return answer(memo.get(mbid) ?? null)

  const url = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          continue
        }
        return NextResponse.json({ error: 'MusicBrainz rate limit' }, { status: 429 })
      }
      if (res.status === 404) {
        return NextResponse.json({ error: 'Unknown artist' }, { status: 404 })
      }
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

      const body = (await res.json()) as {
        relations?: { type?: string; url?: { resource?: string } }[]
      }
      const found = setlistFmArtistUrl(body.relations ?? [])
      memo.set(mbid, found)
      return answer(found)
    } catch (error) {
      if (attempt === 2) {
        console.error(`setlist.fm link ${mbid} failed:`, error)
        return NextResponse.json({ error: 'MusicBrainz unavailable' }, { status: 502 })
      }
    }
  }
  return NextResponse.json({ error: 'Unreachable' }, { status: 500 })
}
