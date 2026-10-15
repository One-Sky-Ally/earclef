/**
 * Discover stock: verified picks written during /refresh-earclef and
 * served in rotation, with no model call on the site (owner, Oct 15
 * 2026). Pure scheduling rules, so they can be tested.
 *
 * SHARED — one set a day for everyone, by calendar date: `days[i]` is
 * the set shown on `startDate + i`. When the stock runs out, earlier
 * sets come back in order, oldest first, labelled "from the archive",
 * so the row is never empty. A refresh records those archive days as
 * they were shown and starts the fresh sets TODAY.
 *
 * OWNER — one set per day the owner visits: the first visit of a day
 * takes the next unseen set, later visits that day see the same set,
 * and days without a visit use nothing. Seen sets are remembered.
 */

export interface StockDay {
  id: string
  /** Shown again from the archive (the stock had run out). */
  archive?: boolean
}

export interface SharedIndex {
  startDate: string
  days: StockDay[]
}

export interface OwnerIndex {
  /** Unseen sets, in the order they will be shown. */
  queue: string[]
  /** The set shown today (or on the last visit day). */
  current?: { date: string; id: string }
  /** Sets already shown, newest first. */
  seen: { date: string; id: string }[]
}

/** Released shared days kept: the archive's depth and the repeat window. */
export const SHARED_KEEP_DAYS = 90
/** Seen owner sets remembered (about three months of visits). */
export const OWNER_SEEN_KEEP = 90
/** How far ahead each list is stocked, at most. */
export const AHEAD_MAX = { shared: 60, owner: 30 } as const
/**
 * Sets one refresh adds at most: the first fill is about two weeks, and
 * each later refresh grows the list toward AHEAD_MAX (owner, Oct 15
 * 2026: "start with about 2 weeks and grow over the next few refreshes").
 */
export const REFRESH_STEP = 14
/** Ready sets the owner's queue may hold. */
export const OWNER_QUEUE_MAX = 90

const DAY_MS = 86_400_000

export function dayIndex(startDate: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

const freshIds = (days: readonly StockDay[]) => [
  ...new Set(days.filter((day) => !day.archive).map((day) => day.id)),
]

/** The shared set for a date, or null when there is no stock at all. */
export function sharedSetFor(
  index: SharedIndex | null,
  date: string,
): { id: string; archive: boolean } | null {
  if (!index || index.days.length === 0) return null
  const i = dayIndex(index.startDate, date)
  if (i < 0) return null
  if (i < index.days.length) {
    const day = index.days[i]
    return { id: day.id, archive: Boolean(day.archive) }
  }
  const fresh = freshIds(index.days)
  if (fresh.length === 0) return null
  return { id: fresh[(i - index.days.length) % fresh.length], archive: true }
}

/** Fresh shared sets still to come after today's. */
export function sharedReady(index: SharedIndex | null, today: string): number {
  if (!index) return 0
  return Math.max(0, index.days.length - (dayIndex(index.startDate, today) + 1))
}

/** The last date with a fresh shared set, or null. */
export function sharedThrough(index: SharedIndex | null): string | null {
  if (!index || index.days.length === 0) return null
  return addDays(index.startDate, index.days.length - 1)
}

/** Set ids shown in the last `windowDays` days (today first), each once. */
export function recentSharedIds(
  index: SharedIndex | null,
  today: string,
  windowDays: number,
): string[] {
  const ids: string[] = []
  for (let back = 0; back < windowDays; back++) {
    const set = sharedSetFor(index, addDays(today, -back))
    if (set && !ids.includes(set.id)) ids.push(set.id)
  }
  return ids
}

/**
 * Adds fresh shared sets. Days already shown from the archive are
 * recorded as shown; the first new set lands on today if today has no
 * fresh set yet. Days older than SHARED_KEEP_DAYS are trimmed; returns
 * the set ids nothing refers to any more.
 */
export function appendShared(
  index: SharedIndex | null,
  newIds: readonly string[],
  today: string,
): { index: SharedIndex; dropped: string[] } {
  if (!index || index.days.length === 0) {
    return { index: { startDate: today, days: newIds.map((id) => ({ id })) }, dropped: [] }
  }
  const days = [...index.days]
  const shownFrom = days.length
  const fresh = freshIds(index.days)
  const todayIndex = dayIndex(index.startDate, today)
  while (days.length < todayIndex && fresh.length > 0) {
    days.push({ id: fresh[(days.length - shownFrom) % fresh.length], archive: true })
  }
  days.push(...newIds.map((id) => ({ id })))

  let startDate = index.startDate
  let kept = days
  const trim = todayIndex - SHARED_KEEP_DAYS
  if (trim > 0) {
    kept = days.slice(trim)
    startDate = addDays(index.startDate, trim)
  }
  const still = new Set(kept.map((day) => day.id))
  const dropped = [...new Set(days.map((day) => day.id))].filter((id) => !still.has(id))
  return { index: { startDate, days: kept }, dropped }
}

/**
 * The owner's set for a visit today. Advances to the next unseen set on
 * the first visit of a day; `changed` says the index must be saved, and
 * `evicted` lists sets that fell out of the remembered history.
 */
export function ownerSetFor(
  index: OwnerIndex | null,
  today: string,
): { index: OwnerIndex | null; id: string | null; changed: boolean; evicted: string[] } {
  if (!index) return { index, id: null, changed: false, evicted: [] }
  if (index.current?.date === today) {
    return { index, id: index.current.id, changed: false, evicted: [] }
  }
  if (index.queue.length === 0) return { index, id: null, changed: false, evicted: [] }
  const [next, ...queue] = index.queue
  const history = index.current ? [index.current, ...index.seen] : index.seen
  const seen = history.slice(0, OWNER_SEEN_KEEP)
  const evicted = history.slice(OWNER_SEEN_KEEP).map((entry) => entry.id)
  return {
    index: { queue, current: { date: today, id: next }, seen },
    id: next,
    changed: true,
    evicted,
  }
}

/** Adds ready owner sets (beyond OWNER_QUEUE_MAX they are refused). */
export function appendOwner(
  index: OwnerIndex | null,
  newIds: readonly string[],
): { index: OwnerIndex; refused: string[] } {
  const base: OwnerIndex = index ?? { queue: [], seen: [] }
  const room = Math.max(0, OWNER_QUEUE_MAX - base.queue.length)
  return {
    index: { ...base, queue: [...base.queue, ...newIds.slice(0, room)] },
    refused: newIds.slice(room),
  }
}

/** Sets a refresh should add, given how many are ready. */
export function setsToAdd(kind: keyof typeof AHEAD_MAX, ready: number): number {
  return Math.max(0, Math.min(REFRESH_STEP, AHEAD_MAX[kind] - ready))
}
