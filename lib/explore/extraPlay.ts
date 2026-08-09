/**
 * Committed verified-play results for gap-fill artists, produced by
 * scripts/build-extra-play.mjs (local sweep: Discogs release videos +
 * YouTube playability + Internet Archive exact-alias). Keys match
 * extraPlayKey() in ./extraArtists.
 *
 * A key that is PRESENT with play:null was swept and verified to have
 * nothing — the sweep's verdict (made with the full alias set,
 * Wikidata labels included) is authoritative; rechecking at runtime
 * with less data would only re-miss. Absent keys were never swept
 * (future gap-fill countries) and may resolve live.
 */
import type { PlayLink } from '../play/types'
import extraPlay from './extra-play.json'

interface ExtraPlayEntry {
  play: PlayLink | null
  /** Discogs artist id recovered by the sweep for an id-less credit. */
  resolvedArtistId?: number | string
}

const DATASET = extraPlay as unknown as {
  generatedAt: string | null
  entries: Record<string, ExtraPlayEntry>
}

/** undefined = never swept; null = swept, nothing verified. */
export function committedExtraPlay(key: string): PlayLink | null | undefined {
  const entry = DATASET.entries[key]
  return entry === undefined ? undefined : entry.play
}

export function recoveredDiscogsId(key: string): number | string | null {
  return DATASET.entries[key]?.resolvedArtistId ?? null
}
