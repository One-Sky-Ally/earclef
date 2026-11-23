/**
 * Past Discover picks (owner, Nov 23 2026: "a lot of recommended artists
 * have come and gone before I listened to them"). Rebuilt from the
 * stock indexes that already exist (./stock) — nothing new is stored:
 *
 * - SHARED: every day from the index's start up to today, the set that
 *   was shown (archive repeats included, each set once). The index keeps
 *   SHARED_KEEP_DAYS, so that is how far back this reaches.
 * - OWNER: the set shown on each day the owner visited (`current` and
 *   `seen`, about OWNER_SEEN_KEEP visits).
 *
 * Reading never advances anything: this is not the owner route, which
 * takes the next set on the first visit of a day. Pure, so it can be
 * tested; the route does the reading.
 */
import { addDays, dayIndex, sharedSetFor, type OwnerIndex, type SharedIndex } from './stock'
import type { DiscoverPick } from './types'

export type PastSource = 'own' | 'shared'

export interface PastSetDay {
  date: string
  id: string
  source: PastSource
}

export interface PastPick {
  pick: DiscoverPick
  /** The most recent day this artist was recommended. */
  lastDate: string
  /** The first day this artist was recommended (within what is kept). */
  firstDate: string
  /** Recommended in the owner's own sets, the shared ones, or both. */
  sources: PastSource[]
}

/** Shared sets shown from the index's start through today, newest first. */
export function sharedPastDays(index: SharedIndex | null, today: string): PastSetDay[] {
  if (!index || index.days.length === 0) return []
  const last = dayIndex(index.startDate, today)
  const days: PastSetDay[] = []
  for (let i = last; i >= 0; i--) {
    const date = addDays(index.startDate, i)
    const set = sharedSetFor(index, date)
    if (set) days.push({ date, id: set.id, source: 'shared' })
  }
  return days
}

/** The owner's sets shown so far (today's included), newest first. */
export function ownerPastDays(index: OwnerIndex | null, today: string): PastSetDay[] {
  if (!index) return []
  const shown = index.current ? [index.current, ...index.seen] : index.seen
  return shown
    .filter((entry) => entry.date <= today)
    .map((entry) => ({ date: entry.date, id: entry.id, source: 'own' as const }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/**
 * One entry per artist (by MusicBrainz id), newest recommendation first.
 * The pick's text and song come from the most recent set it was in.
 * Sets that no longer exist are skipped.
 */
export function collectPastPicks(
  days: readonly PastSetDay[],
  picksBySet: ReadonlyMap<string, readonly DiscoverPick[]>,
): PastPick[] {
  const byMbid = new Map<string, PastPick>()
  const ordered = [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  for (const day of ordered) {
    for (const pick of picksBySet.get(day.id) ?? []) {
      const seen = byMbid.get(pick.mbid)
      if (!seen) {
        byMbid.set(pick.mbid, {
          pick,
          lastDate: day.date,
          firstDate: day.date,
          sources: [day.source],
        })
        continue
      }
      if (day.date < seen.firstDate) seen.firstDate = day.date
      if (!seen.sources.includes(day.source)) seen.sources.push(day.source)
    }
  }
  return [...byMbid.values()]
}
