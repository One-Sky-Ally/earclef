/**
 * The feed build's second chance (Nov 24, 2026). An artist whose
 * MusicBrainz or Apple lookup did not answer in the main pass keeps
 * what did answer plus last night's confirmed rows, and is noted. When
 * the main pass reaches the end of the roster, those artists are asked
 * once more; a full answer then replaces their rows. Not answering twice
 * is still not a verdict: their kept rows stay.
 *
 * Pure helpers — the network side lives in ./snapshot's buildBatch.
 * Relative imports only: bundled into the Netlify background function.
 */
import { normalizedTitle } from './blurbKey'
import type { SnapshotItem } from './snapshot'

export interface RetryState {
  cursor: number
  /** Artists (slugs) whose lookup did not fully answer and have not been asked again. */
  retry?: string[]
  /** Artists asked again that still did not answer (for the log). */
  unanswered?: string[]
}

/** The main pass is over and someone is waiting for a second try. */
export function inRetryPass(state: RetryState, rosterLength: number): boolean {
  return state.cursor >= rosterLength && (state.retry?.length ?? 0) > 0
}

/** Done when the roster is walked and nobody is waiting for a second try. */
export function buildIsDone(state: RetryState, rosterLength: number): boolean {
  return state.cursor >= rosterLength && (state.retry?.length ?? 0) === 0
}

/** Note an artist for the second try, once. */
export function noteForRetry(retry: readonly string[] | undefined, slug: string): string[] {
  const list = retry ?? []
  return list.includes(slug) ? [...list] : [...list, slug]
}

/** The artist's release rows swapped for a full answer; everything else as it was. */
export function replaceArtistReleases(
  items: readonly SnapshotItem[],
  slug: string,
  fresh: readonly SnapshotItem[],
): SnapshotItem[] {
  return [
    ...items.filter((item) => !(item.type === 'release' && item.slug === slug)),
    ...fresh.filter((item) => item.type === 'release' && item.slug === slug),
  ]
}

/**
 * When MusicBrainz or Apple did not answer for an artist, the releases
 * last night's snapshot confirmed for them stay (not answering is never
 * a verdict). Only rows built under the confirmation rule (they carry
 * `links`) are carried, so a bootleg from an older snapshot never is.
 */
export function carriedReleases(
  slug: string,
  fresh: readonly SnapshotItem[],
  previous: readonly SnapshotItem[],
): SnapshotItem[] {
  const have = new Set(
    fresh.filter((item) => item.type === 'release').map((item) => normalizedTitle(item.title)),
  )
  return previous.filter(
    (item) =>
      item.type === 'release' &&
      item.slug === slug &&
      item.links !== undefined &&
      !have.has(normalizedTitle(item.title)),
  )
}
