import discogsVideosIndex from './discogs-videos/index.json'

/**
 * Where to look before spending a YouTube search: the videos Discogs
 * lists on an artist's own records whose titles name one of their works.
 * Built offline by scripts/build-discogs-videos.mjs from the local MB
 * and Discogs dumps (owner go, Nov 19 2026). These are leads, not
 * answers: the queue resolver re-reads each video with videos.list and
 * applies the artistMatch checks and the music gates before anything
 * plays.
 *
 * Same serving pattern as rg-dating: 256 shards keyed by the first two
 * hex characters of the MBID, imported one at a time so a request parses
 * one small shard. The template-literal import lets webpack trace every
 * shard into the deployment.
 */

/** [videoId, workTitle, year | null, 'm' (MB catalogue title) | 'd' (Discogs only)] */
export type DiscogsVideoRow = [string, string, number | null, 'm' | 'd']

const AVAILABLE = new Set((discogsVideosIndex as { shards: string[] }).shards)

export const DISCOGS_VIDEOS_VERSION = (discogsVideosIndex as { version: string }).version

const cache = new Map<string, Record<string, DiscogsVideoRow[]> | null>()

async function loadShard(prefix: string): Promise<Record<string, DiscogsVideoRow[]> | null> {
  const held = cache.get(prefix)
  if (held !== undefined) return held
  let shard: Record<string, DiscogsVideoRow[]> | null = null
  if (AVAILABLE.has(prefix)) {
    try {
      const loaded = await import(`./discogs-videos/${prefix}.json`)
      shard = (loaded.default ?? loaded) as Record<string, DiscogsVideoRow[]>
    } catch {
      // A missing shard means no leads; the resolver carries on.
      shard = null
    }
  }
  cache.set(prefix, shard)
  return shard
}

/** The artist's Discogs leads, or [] — a common, meaningful answer. */
export async function discogsVideosFor(mbid: string): Promise<DiscogsVideoRow[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(mbid)) return []
  const shard = await loadShard(mbid.slice(0, 2))
  return shard?.[mbid] ?? []
}
