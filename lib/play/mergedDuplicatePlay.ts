/**
 * Play links carried from a merged duplicate (owner brief, Nov 23 2026).
 *
 * Some artists sat on the site twice: a MusicBrainz copy (mb:<mbid>)
 * and a gap-fill pool copy (dg:<discogs id>) that carried the only
 * verified ▶. When the owner keeps the MusicBrainz copy, the pool copy
 * moves to data/mb-duplicates-held.json and its link — only one that
 * already served, identity evidence and all — is carried here, keyed by
 * the MB copy's play key.
 *
 * Written ONLY by scripts/apply-mb-duplicate-rulings.mjs from
 * owner-approved, hand-checked rulings. No matching of any kind happens
 * at runtime: a key is either listed or it is not.
 */
import type { PlayLink } from './types'
import carried from './merged-duplicate-play.json'

interface CarriedPlay {
  fromKey: string
  play: PlayLink
  identityEvidence: { anchors: string[]; legs: string[]; verifiedAt: string }
}

const LINKS = (carried as unknown as { links: Record<string, CarriedPlay> }).links

/** The carried link for an mb:<mbid> key, or null. */
export function mergedDuplicatePlay(key: string): PlayLink | null {
  if (!key.startsWith('mb:')) return null
  const entry = LINKS[key]
  // Read-time guard: a carried link must still carry its evidence
  // (standing lesson 2 — committed data outlives the pass that wrote it).
  if (!entry?.play || !entry.identityEvidence) return null
  return entry.play
}
