/**
 * The feed's length rule (owner, Nov 18 2026: "a lot of clips aren't
 * very good — remove anything shorter than a minute, including clips
 * already in the feed").
 *
 * Pure and JSON-free so Node's test runner can load it; the Blobs cache
 * and the YouTube lookup live in ./videoLengths.
 *
 * RELATIVE imports only — bundled into the Netlify background function.
 */

/** A minute exactly stays; 59 seconds goes. */
export const MIN_CLIP_SECONDS = 60

/**
 * How long a learned length is trusted before it is looked up again.
 * Data fetched with the API key may be kept at most 30 days, then
 * refreshed or deleted (YouTube Developer Policies III.E.4; the privacy
 * page promises the same) — 29 leaves a day's margin.
 */
const LENGTH_TTL_MS = 29 * 24 * 60 * 60 * 1000
/**
 * Live and upcoming broadcasts answer 0 seconds until they end; look
 * them up again within hours so a premiere returns once it has a length.
 */
const NO_LENGTH_TTL_MS = 6 * 60 * 60 * 1000

/** One cached answer: seconds long, and when YouTube said so. */
export interface LengthEntry {
  s: number
  at: string
}

export type LengthCache = Record<string, LengthEntry>

/**
 * ISO-8601 duration (YouTube contentDetails) → seconds. Handles a days
 * part ("P1DT2H") and the live/upcoming "P0D"; null when unreadable.
 */
export function parseIsoDurationSeconds(iso: string | undefined): number | null {
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? '')
  if (!match || iso === 'P') return null
  const [days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0))
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

interface MaybeVideo {
  type: 'release' | 'video'
  videoId?: string
  /** Stamped by the nightly rebuild; absent on snapshots stored before it. */
  seconds?: number
}

/**
 * Drops videos known to run under a minute. A video whose length is
 * unknown (the lookup failed, or no key) is KEPT — pruning never rides
 * on a timeout — and judged again on the next read or rebuild.
 */
export function dropShortClips<T extends MaybeVideo>(
  items: T[],
  lengths: Record<string, number>,
): T[] {
  return items.filter((item) => {
    if (item.type !== 'video') return true
    const seconds =
      item.seconds ?? (item.videoId ? lengths[item.videoId] : undefined)
    return seconds === undefined || seconds >= MIN_CLIP_SECONDS
  })
}

/**
 * The lengths the nightly rebuild may judge: a live or upcoming broadcast
 * (0 s, no length yet) is left unstamped so it stays in the snapshot and
 * the read path judges it again once it has aired — a premiere later in
 * the day must not miss the whole night.
 */
export function settledLengths(
  lengths: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(lengths).filter(([, seconds]) => seconds > 0),
  )
}

/** The cache entries still worth trusting at `now` (a new object). */
export function freshLengths(cache: LengthCache, now: number): LengthCache {
  return Object.fromEntries(
    Object.entries(cache).filter(([, entry]) => {
      const age = now - Date.parse(entry.at)
      return age < (entry.s > 0 ? LENGTH_TTL_MS : NO_LENGTH_TTL_MS)
    }),
  )
}
