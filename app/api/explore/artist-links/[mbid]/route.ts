import { NextResponse } from 'next/server'
import type { ArtistLinks } from '@/lib/explore/panelData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Warm-process memoization; the CDN Cache-Control header does the real work.
const memo = new Map<string, ArtistLinks>()

interface MbUrlRelation {
  type?: string
  url?: { resource?: string }
}

/**
 * Classify MusicBrainz URL relations by DOMAIN, not relation type —
 * types vary ("streaming", "free streaming", "official homepage"), but
 * the hostnames don't lie.
 */
function toLinks(relations: MbUrlRelation[]): ArtistLinks {
  const links: ArtistLinks = {}
  for (const relation of relations) {
    const resource = relation.url?.resource
    if (!resource) continue
    let host: string
    try {
      host = new URL(resource).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (host === 'open.spotify.com' && !links.spotify) {
      links.spotify = resource
    } else if (host === 'music.apple.com' && !links.appleMusic) {
      links.appleMusic = resource
    } else if (
      (host === 'music.amazon.com' || host.startsWith('music.amazon.')) &&
      !links.amazonMusic
    ) {
      links.amazonMusic = resource
    } else if (
      (host === 'youtube.com' || host === 'm.youtube.com') &&
      !links.youtube
    ) {
      links.youtube = resource
    } else if (host.endsWith('.wikipedia.org') && !links.wikipedia) {
      links.wikipedia = resource
    } else if (relation.type === 'official homepage' && !links.website) {
      links.website = resource
    }
  }
  return links
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ mbid: string }> },
) {
  const { mbid } = await ctx.params
  if (!UUID.test(mbid)) {
    return NextResponse.json({ error: 'Invalid artist id' }, { status: 400 })
  }

  const cached = memo.get(mbid)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  const url = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          continue
        }
        return NextResponse.json(
          { error: 'MusicBrainz rate limit' },
          { status: 429 },
        )
      }
      if (res.status === 404) {
        return NextResponse.json({ error: 'Unknown artist' }, { status: 404 })
      }
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

      const body = (await res.json()) as { relations?: MbUrlRelation[] }
      const links = toLinks(body.relations ?? [])
      memo.set(mbid, links)
      return withCacheHeaders(NextResponse.json(links))
    } catch (error) {
      if (attempt === 2) {
        console.error(`artist links ${mbid} failed:`, error)
        return NextResponse.json(
          { error: 'MusicBrainz unavailable' },
          { status: 502 },
        )
      }
    }
  }
  return NextResponse.json({ error: 'Unreachable' }, { status: 500 })
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
