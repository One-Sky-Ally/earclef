import { NextResponse } from 'next/server'
import { getStore } from '@netlify/blobs'
import {
  committedExtraPlay,
  recoveredDiscogsId,
} from '@/lib/explore/extraPlay'
import {
  resolveExtraArtistPlay,
  resolveMbArtistPlay,
} from '@/lib/play/resolve'
import type { ArtistPlay, ReadLink } from '@/lib/play/types'

/**
 * Verified-play resolver: ONE artist → their verified play destination
 * (or an honest null; callers render no play button then). Key formats:
 *
 *   mb:<mbid>        MusicBrainz artist — full chain (queue cache,
 *                    url-rels, Internet Archive). Optional ?decade=1970
 *                    peeks at the era queue's playability-checked video.
 *   dg:<discogs-id>  Gap-fill artist known to Discogs
 *   wd:<Q-id>        Gap-fill artist known to Wikidata
 *   nm:<slug>        Gap-fill artist with no source id at all
 *
 * Non-MB keys carry ?name= for the Internet Archive creator search —
 * their only runtime chain step (the live site never calls Discogs;
 * a build-time enrichment sweep can add committed video links later).
 * Results cache 30 days in Blobs and ride a 30-day CDN header.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DECADE = /^(19|20)\d0$/
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const memo = new Map<string, ArtistPlay>()

interface CachedPlay {
  at: string
  result: ArtistPlay
}

async function readCache(key: string): Promise<ArtistPlay | null> {
  try {
    const cached = (await getStore({
      name: 'play',
      consistency: 'eventual',
    }).get(key, { type: 'json' })) as CachedPlay | null
    if (!cached) return null
    const fresh = Date.now() - new Date(cached.at).getTime() < CACHE_TTL_MS
    return fresh ? cached.result : null
  } catch {
    return null // no Blobs context (dev)
  }
}

async function writeCache(key: string, result: ArtistPlay): Promise<void> {
  try {
    await getStore({ name: 'play', consistency: 'eventual' }).setJSON(key, {
      at: new Date().toISOString(),
      result,
    })
  } catch {
    // no Blobs context (dev) — the warm-process memo covers it
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}

function extraRead(source: string, id: string): ReadLink {
  return source === 'dg'
    ? { kind: 'discogs', url: `https://www.discogs.com/artist/${id}` }
    : { kind: 'wikidata', url: `https://www.wikidata.org/wiki/${id}` }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params
  const [source, ...rest] = decodeURIComponent(key).split(':')
  const id = rest.join(':')
  const search = new URL(request.url).searchParams
  const name = search.get('name')?.trim().slice(0, 200) ?? ''
  const decadeParam = search.get('decade')
  const decade = decadeParam && DECADE.test(decadeParam) ? decadeParam : null

  const validKey =
    (source === 'mb' && UUID.test(id)) ||
    (source === 'dg' && /^\d{1,12}$/.test(id)) ||
    (source === 'wd' && /^Q\d{1,12}$/.test(id)) ||
    (source === 'nm' && /^[a-z0-9-]{1,80}$/.test(id))
  if (!validKey) {
    return NextResponse.json({ error: 'Invalid artist key' }, { status: 400 })
  }
  if (source !== 'mb' && !name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }

  // Decade only sharpens mb: results (a cached era video) — cache the
  // sharpened result under its own key so eras don't overwrite each other.
  // v2 buried the containment-matched IA results (Alexandra incident);
  // v3 adds alias-set matching, so v2 nulls for non-Latin names are
  // retried with romanized spellings instead of aging out over 30 days.
  const cacheKey = `v3/${source}/${id}${decade ? `/${decade}` : ''}`
  const memoized = memo.get(cacheKey)
  if (memoized) return withCacheHeaders(NextResponse.json(memoized))
  const cached = await readCache(cacheKey)
  if (cached) {
    memo.set(cacheKey, cached)
    return withCacheHeaders(NextResponse.json(cached))
  }

  try {
    // Id-less credits whose Discogs id the sweep recovered get a real
    // artist page; the rest fall back to an all-sections search (the
    // artist tab alone can be empty while their release still shows).
    const recovered = source === 'nm' ? recoveredDiscogsId(`nm:${id}`) : null
    const read =
      source === 'nm'
        ? recovered
          ? ({
              kind: 'discogs',
              url: `https://www.discogs.com/artist/${recovered}`,
            } as const)
          : ({
              kind: 'discogs',
              url: `https://www.discogs.com/search/?q=${encodeURIComponent(name)}`,
            } as const)
        : extraRead(source, id)
    // Swept gap-fill keys serve the committed verdict — the sweep ran
    // with the full alias set (Wikidata labels included), so a live
    // recheck with less data could only re-miss.
    const committed =
      source === 'mb' ? undefined : committedExtraPlay(`${source}:${id}`)
    const result =
      source === 'mb'
        ? await resolveMbArtistPlay(id, decade)
        : committed !== undefined
          ? { play: committed, read }
          : await resolveExtraArtistPlay(name, read)
    memo.set(cacheKey, result)
    await writeCache(cacheKey, result)
    return withCacheHeaders(NextResponse.json(result))
  } catch (error) {
    console.error(`play resolve ${cacheKey} failed:`, error)
    return NextResponse.json({ error: 'Resolution failed' }, { status: 502 })
  }
}
