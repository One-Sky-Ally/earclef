/**
 * Durable storage for Discover pools and pick history, on Netlify Blobs.
 * Two kinds of pool live side by side: the SHARED pool every visitor
 * sees (the original keys, unprefixed) and the OWNER's own pool (keys
 * under `owner/`), each with its own history so neither one's repeat
 * window blocks the other. Every accessor tolerates a missing Blobs
 * context (local `next dev` has none) by returning null / no-op —
 * callers fall back to in-process memos.
 */
import { getStore } from '@netlify/blobs'
import type { DiscoverPool } from './generate'
import type { PoolKind } from './library'

export interface HistoryEntry {
  name: string
  date: string
}

const HISTORY_CAP = 200
/** Names recommended within this window are excluded from new pools. */
export const REPEAT_WINDOW_DAYS = 90

function store() {
  return getStore({ name: 'discover', consistency: 'strong' })
}

const prefix = (kind: PoolKind) => (kind === 'owner' ? 'owner/' : '')
const poolKey = (kind: PoolKind, date: string) => `${prefix(kind)}pool-${date}`
const latestKey = (kind: PoolKind) => `${prefix(kind)}latest-date`
const historyKey = (kind: PoolKind) => `${prefix(kind)}history`
const lockKey = (kind: PoolKind) => `${prefix(kind)}generation-lock`

export async function readPool(
  date: string,
  kind: PoolKind = 'shared',
): Promise<DiscoverPool | null> {
  try {
    return (await store().get(poolKey(kind, date), { type: 'json' })) as
      | DiscoverPool
      | null
  } catch {
    return null
  }
}

/** Most recent pool on record, regardless of date (stale fallback). */
export async function readLatestPool(
  kind: PoolKind = 'shared',
): Promise<DiscoverPool | null> {
  try {
    const latestDate = (await store().get(latestKey(kind), { type: 'text' })) as
      | string
      | null
    if (!latestDate) return null
    return await readPool(latestDate, kind)
  } catch {
    return null
  }
}

export async function writePool(
  pool: DiscoverPool,
  kind: PoolKind = 'shared',
): Promise<void> {
  try {
    const s = store()
    await s.setJSON(poolKey(kind, pool.date), pool)
    await s.set(latestKey(kind), pool.date)
  } catch {
    // No Blobs context (dev) — in-process memo covers it.
  }
}

export async function readRecentNames(
  today: string,
  kind: PoolKind = 'shared',
): Promise<string[]> {
  try {
    const entries = ((await store().get(historyKey(kind), { type: 'json' })) ??
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

export async function appendHistory(
  pool: DiscoverPool,
  kind: PoolKind = 'shared',
): Promise<void> {
  try {
    const s = store()
    const entries = ((await s.get(historyKey(kind), { type: 'json' })) ??
      []) as HistoryEntry[]
    const merged = [
      ...entries,
      ...pool.picks.map((pick) => ({ name: pick.name, date: pool.date })),
    ].slice(-HISTORY_CAP)
    await s.setJSON(historyKey(kind), merged)
  } catch {
    // No Blobs context (dev) — history is best-effort there.
  }
}

/**
 * Cheap generation lock: claims the date if unclaimed. Not transactional —
 * good enough to stop trigger spam from stacking duplicate model calls,
 * with the date-keyed pool write making duplicates harmless anyway.
 */
export async function claimGeneration(
  date: string,
  kind: PoolKind = 'shared',
): Promise<boolean> {
  try {
    const s = store()
    const current = (await s.get(lockKey(kind), { type: 'text' })) as string | null
    if (current === date) return false
    await s.set(lockKey(kind), date)
    return true
  } catch {
    return true // dev: no lock needed, in-process memo dedupes
  }
}
