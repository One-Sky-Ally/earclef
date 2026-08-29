import { NextResponse } from 'next/server'
import { getStore } from '@netlify/blobs'
import {
  committedExtraPlay,
  recoveredDiscogsId,
} from '@/lib/explore/extraPlay'
import { archivalPlay } from '@/lib/play/archival'
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
/**
 * Resolver rules version of the entry's WRITER (standing lesson 2 —
 * fixing a resolver does not fix what the old one wrote).
 * 1 = streaming class in the chain (Aug 30, 2026): an mb: null written
 * under older rules may now resolve to a streaming page and re-runs;
 * a null written AT this pass is a real null and stands its 30 days.
 */
const RESOLVER_PASS = 1
const memo = new Map<string, ArtistPlay>()

interface CachedPlay {
  at: string
  result: ArtistPlay
  /** Writer's rules version; absent = pre-streaming (see RESOLVER_PASS). */
  pass?: number
}

async function readCache(
  key: string,
  isStale: (cached: CachedPlay) => boolean,
): Promise<ArtistPlay | null> {
  try {
    const cached = (await getStore({
      name: 'play',
      consistency: 'eventual',
    }).get(`v2:${key}`, { type: 'json' })) as CachedPlay | null
    if (!cached || isStale(cached)) return null
    const fresh = Date.now() - new Date(cached.at).getTime() < CACHE_TTL_MS
    return fresh ? cached.result : null
  } catch {
    return null // no Blobs context (dev)
  }
}

async function writeCache(key: string, result: ArtistPlay): Promise<void> {
  try {
    // v2: key bump Aug 29 2026 — flushes every pre-incident cached
    // result (a fixed resolver does not fix what the old one wrote).
    await getStore({ name: 'play', consistency: 'eventual' }).setJSON(`v2:${key}`, {
      at: new Date().toISOString(),
      result,
      pass: RESOLVER_PASS,
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
      : source === 'mb'
        ? null
        : extraRead(source, id)

  // Highest trust first: an OWNER-curated archival mapping outranks
  // every automated result — each one is a human judgment reviewed in
  // a commit (lib/play/archival.ts).
  const archival = archivalPlay(`${source}:${id}`)
  if (archival) {
    const mbRead: ReadLink = {
      kind: 'musicbrainz',
      url: `https://musicbrainz.org/artist/${id}`,
    }
    return withCacheHeaders(
      NextResponse.json({ play: archival, read: read ?? mbRead }),
    )
  }

  // Committed sweep verdicts serve BEFORE any cache: they are a static
  // import (zero upstream cost) and authoritative — the sweep ran with
  // the full alias set, so a live recheck could only re-miss. Checking
  // Blobs first once shadowed a committed video behind a stale null.
  if (source !== 'mb' && read) {
    const committed = committedExtraPlay(`${source}:${id}`)
    if (committed !== undefined) {
      return withCacheHeaders(NextResponse.json({ play: committed, read }))
    }
  }

  // Decade only sharpens mb: results (a cached era video) — cache the
  // sharpened result under its own key so eras don't overwrite each other.
  // v2 buried the containment-matched IA results (Alexandra incident);
  // v3 added alias-set matching; v4 buried pre-parked-gate official
  // links (Salim Dada); v5 buries play results that inherited
  // bare-name search tracks from the queue cache (John Mayer).
  const cacheKey = `v5/${source}/${id}${decade ? `/${decade}` : ''}`
  // Streaming class added Aug 30 2026: a PRE-STREAMING cached mb: null
  // may now resolve (Nawang Khechog's Spotify rel) — treat exactly
  // those as misses instead of bumping the whole keyspace. Every
  // non-null result outranks streaming in the chain and stands; nulls
  // written at the current pass are real and stand their 30 days;
  // non-mb keys gain nothing from streaming, so their nulls stand too.
  // (The warm-process memo only ever holds this deploy's results.)
  const preStreamingNull = (cached: CachedPlay) =>
    source === 'mb' &&
    cached.result.play === null &&
    (cached.pass ?? 0) < RESOLVER_PASS
  const memoized = memo.get(cacheKey)
  if (memoized) return withCacheHeaders(NextResponse.json(memoized))
  const cached = await readCache(cacheKey, preStreamingNull)
  if (cached) {
    memo.set(cacheKey, cached)
    return withCacheHeaders(NextResponse.json(cached))
  }

  try {
    const result =
      source === 'mb'
        ? await resolveMbArtistPlay(id, decade)
        : await resolveExtraArtistPlay(name, read as ReadLink)
    memo.set(cacheKey, result)
    await writeCache(cacheKey, result)
    return withCacheHeaders(NextResponse.json(result))
  } catch (error) {
    console.error(`play resolve ${cacheKey} failed:`, error)
    return NextResponse.json({ error: 'Resolution failed' }, { status: 502 })
  }
}
