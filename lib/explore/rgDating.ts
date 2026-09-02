import rgDatingIndex from './rg-dating/index.json'

/**
 * Era-dating corrections, served from the committed dataset built by
 * scripts/build-rg-dating-apply.mjs (owner-approved Sep 1, 2026).
 *
 * THE PRINCIPLE THESE ENCODE: music belongs to the year its recording
 * was made. A compilation's songs carry their original years; a pure
 * retrospective represents an era, held as a SPAN, never an invented
 * single year. Live albums and re-recordings were excluded upstream —
 * ABSENCE FROM THIS DATASET MEANS "MusicBrainz's year stands", which is
 * why the consumers need no second signal.
 *
 * Same serving pattern as country-artists: 256 shards keyed by the
 * first two hex chars of the artist MBID, dynamic import per shard so a
 * request parses ~35 KB, never 8.8 MB. The template-literal import is
 * what lets webpack trace every shard into the deployment.
 *
 * RG_DATING_VERSION is the cache key half of move-don't-copy: queue
 * resolutions record the version they were computed under, so a
 * corrections refresh lazily invalidates exactly the artists it
 * touches — artists without corrections never re-resolve at all.
 */

export interface ArtistDating {
  /** titleKey → original year for individually-dated songs. */
  s: Record<string, number>
  /** release-group id → [earliest, newest] span of a retrospective. */
  a: Record<string, [number, number]>
}

export const RG_DATING_VERSION = (rgDatingIndex as { version: string }).version

const AVAILABLE = new Set(
  (rgDatingIndex as { shards: string[] }).shards,
)

const cache = new Map<string, Record<string, ArtistDating> | null>()

async function loadShard(
  prefix: string,
): Promise<Record<string, ArtistDating> | null> {
  const held = cache.get(prefix)
  if (held !== undefined) return held
  let shard: Record<string, ArtistDating> | null = null
  if (AVAILABLE.has(prefix)) {
    try {
      const loaded = await import(`./rg-dating/${prefix}.json`)
      shard = (loaded.default ?? loaded) as Record<string, ArtistDating>
    } catch {
      // A missing shard is no opinion; the caller keeps MB's dates.
      shard = null
    }
  }
  cache.set(prefix, shard)
  return shard
}

/**
 * The corrections for one artist, or null when there are none — and
 * null is the common, meaningful answer: MusicBrainz's dates stand.
 */
export async function rgDatingFor(mbid: string): Promise<ArtistDating | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(mbid)) {
    return null
  }
  const shard = await loadShard(mbid.slice(0, 2))
  return shard?.[mbid] ?? null
}

/**
 * The same title normalisation the corrections were BUILT under
 * (scripts/build-rg-dating-evidence.mjs). The two must never drift: a
 * corrected song is found by this key or not at all.
 */
export function rgDatingTitleKey(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
