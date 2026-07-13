/**
 * Durable storage for Discover pools and pick history, on Netlify Blobs.
 * Every accessor tolerates a missing Blobs context (local `next dev` has
 * none) by returning null / no-op — callers fall back to in-process memos.
 */
import { getStore } from '@netlify/blobs'
import type { DiscoverPool } from './generate'

export interface HistoryEntry {
  name: string
  date: string
}

const HISTORY_KEY = 'history'
const LATEST_KEY = 'latest-date'
const LOCK_KEY = 'generation-lock'
const HISTORY_CAP = 200
/** Names recommended within this window are excluded from new pools. */
export const REPEAT_WINDOW_DAYS = 90

function store() {
  return getStore({ name: 'discover', consistency: 'strong' })
}

export async function readPool(date: string): Promise<DiscoverPool | null> {
  try {
    return (await store().get(`pool-${date}`, { type: 'json' })) as
      | DiscoverPool
      | null
  } catch {
    return null
  }
}

/** Most recent pool on record, regardless of date (stale fallback). */
export async function readLatestPool(): Promise<DiscoverPool | null> {
  try {
    const latestDate = (await store().get(LATEST_KEY, { type: 'text' })) as
      | string
      | null
    if (!latestDate) return null
    return await readPool(latestDate)
  } catch {
    return null
  }
}

export async function writePool(pool: DiscoverPool): Promise<void> {
  try {
    const s = store()
    await s.setJSON(`pool-${pool.date}`, pool)
    await s.set(LATEST_KEY, pool.date)
  } catch {
    // No Blobs context (dev) — in-process memo covers it.
  }
}

export async function readRecentNames(today: string): Promise<string[]> {
  try {
    const entries = ((await store().get(HISTORY_KEY, { type: 'json' })) ??
      []) as HistoryEntry[]
    const cutoff = new Date(`${today}T00:00:00Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - REPEAT_WINDOW_DAYS)
    const cutoffKey = cutoff.toISOString().slice(0, 10)
    return entries
      .filter((entry) => entry.date >= cutoffKey)
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

export async function appendHistory(pool: DiscoverPool): Promise<void> {
  try {
    const s = store()
    const entries = ((await s.get(HISTORY_KEY, { type: 'json' })) ??
      []) as HistoryEntry[]
    const merged = [
      ...entries,
      ...pool.picks.map((pick) => ({ name: pick.name, date: pool.date })),
    ].slice(-HISTORY_CAP)
    await s.setJSON(HISTORY_KEY, merged)
  } catch {
    // No Blobs context (dev) — history is best-effort there.
  }
}

/**
 * Cheap generation lock: claims the date if unclaimed. Not transactional —
 * good enough to stop trigger spam from stacking duplicate model calls,
 * with the date-keyed pool write making duplicates harmless anyway.
 */
export async function claimGeneration(date: string): Promise<boolean> {
  try {
    const s = store()
    const current = (await s.get(LOCK_KEY, { type: 'text' })) as string | null
    if (current === date) return false
    await s.set(LOCK_KEY, date)
    return true
  } catch {
    return true // dev: no lock needed, in-process memo dedupes
  }
}
