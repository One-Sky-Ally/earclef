/**
 * The panel's render pool, built in ONE place for both sides of the
 * wire: CountryPanel renders from it, and the country route uses it to
 * decide which undated gap-fill entries a visitor can ever reach. The
 * server's trim is only honest if it sees exactly the pool the panel
 * will build — sharing the function (and RENDER_CAP) is what keeps the
 * two from drifting apart.
 *
 * Client-safe: no server datasets are imported here.
 */
import { canonicalizeTags } from './genreFamilies'
import type {
  CountryYearDetails,
  OmittedUndated,
  PoolArtist,
} from './panelData'

/**
 * The panel's hard render cap everywhere (tiers, genre filter). The
 * trim below keeps every undated entry that can land inside it.
 */
export const RENDER_CAP = 100

/**
 * The panel's render pool. MusicBrainz entries and the gap-fill
 * entries (Discogs/Wikidata, for places MB has no record of) are ONE
 * list to visitors — same pill, same tiers, same genre filter. The
 * only difference is where a pill points, and it is invisible until
 * clicked. "Never merge" is a data rule (separate storage, separate
 * dedup, MB canonical); it is not a display rule.
 */
export interface PanelPoolArtist extends PoolArtist {
  /** Non-MB entry: the pill links out to the source documenting it. */
  externalUrl?: string
  /** Source carries no date at all — sorts last, tagged quietly. */
  undated?: boolean
  /** Verified-play resolver key for non-MB entries (dg:/wd:/nm:). */
  playKey?: string
  /** Non-MB entry's pre-verified video for the queue (see QueuePlayer). */
  queueTrack?: { videoId: string; title: string }
}

/**
 * The discovery pool — cached pre-pool responses degrade to the
 * top-12 list (no tags → no chips, search over what's there).
 */
export function mbPoolOf(details: CountryYearDetails): PoolArtist[] {
  return details.panelArtists?.length
    ? details.panelArtists
    : details.originArtists.map((artist) => ({ ...artist, tags: [] }))
}

/**
 * One list. MusicBrainz first (tag-weight ranked, the deepest
 * signal), then era-dated gap-fill entries in press-count order,
 * then undated ones — no cross-source ranking is invented, because
 * MB tag votes and Discogs pressing counts share no scale. Styles
 * lowercase so they pool with MB tags in the genre filter.
 *
 * Gap-fill entries arrive SHAPED from the API (pill URL + play key
 * computed server-side) — the dataset never ships to the client.
 * Stored pre-change payloads lack the field; degrade to MB-only.
 * Archive-presence entries are NOT in this pool: they render in
 * their own section and never join the count or the genre filter.
 */
export function panelPoolOf(details: CountryYearDetails): PanelPoolArtist[] {
  const extra = details.extraArtists
  // One canonicalization for every source that reaches this list.
  // MB entries arrive already collapsed (the server had to, before
  // its top-4 cut destroyed the evidence); gap-fill styles, state,
  // historical and claimed-place entries carry their full lists and
  // are collapsed here. canonicalizeTags is idempotent, so the one
  // call covers all of them without caring which is which.
  return [
    ...mbPoolOf(details),
    ...(extra?.dated ?? []),
    ...(extra?.undated ?? []),
  ].map((artist) => ({ ...artist, tags: canonicalizeTags(artist.tags) }))
}

/**
 * Whether the play queue can ever walk this entry. Gap-fill entries
 * (they carry a playKey) play only through their pre-verified track.
 */
export function queueEligible(artist: PanelPoolArtist): boolean {
  return !artist.playKey || Boolean(artist.queueTrack)
}

/**
 * A country's undated gap-fill list is the SAME for every year and is
 * most of a sparse country's panel payload (Congo-Kinshasa: 675
 * entries, ~70% of the response), yet the panel can only ever show a
 * fraction of it. This keeps every undated entry a visitor can reach
 * and replaces the rest with counts:
 *
 *   - inside the first RENDER_CAP of the unfiltered list (the tiers);
 *   - inside the first RENDER_CAP of ANY genre the filter offers —
 *     every canonical tag in the pool, since selecting one is the
 *     panel's way past the overall top 100;
 *   - anything the play queue can walk (a pre-verified queueTrack).
 *     The queue has no depth cap of its own, so these all stay.
 *
 * What is left out is therefore never rendered and never queued; the
 * panel adds `undatedOmitted` back into its totals and genre counts.
 * Order is untouched, so every kept entry sits exactly where it did.
 */
export function withReachableUndated(
  details: CountryYearDetails,
): CountryYearDetails {
  const extra = details.extraArtists
  const undated = extra?.undated ?? []
  if (!extra || undated.length === 0) return details

  const pool = panelPoolOf(details)
  const undatedFrom = pool.length - undated.length
  const reachable = new Set<number>()
  const seenPerTag = new Map<string, number>()
  pool.forEach((artist, index) => {
    const inUndated = index >= undatedFrom
    if (inUndated && (index < RENDER_CAP || queueEligible(artist))) {
      reachable.add(index)
    }
    for (const tag of artist.tags) {
      const rank = (seenPerTag.get(tag) ?? 0) + 1
      seenPerTag.set(tag, rank)
      if (inUndated && rank <= RENDER_CAP) reachable.add(index)
    }
  })

  const kept = undated.filter((_, i) => reachable.has(undatedFrom + i))
  if (kept.length === undated.length) return details

  // A Map, not an object literal: a tag named "constructor" must count
  // from zero, not from an Object.prototype member.
  const omittedTags = new Map<string, number>()
  for (let i = 0; i < undated.length; i++) {
    if (reachable.has(undatedFrom + i)) continue
    for (const tag of pool[undatedFrom + i].tags) {
      omittedTags.set(tag, (omittedTags.get(tag) ?? 0) + 1)
    }
  }
  const omitted: OmittedUndated = {
    count: undated.length - kept.length,
    tags: Object.fromEntries(omittedTags),
  }
  return {
    ...details,
    extraArtists: { ...extra, undated: kept, undatedOmitted: omitted },
  }
}
