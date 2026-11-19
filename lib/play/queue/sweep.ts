/**
 * The nightly 30-day sweep (owner go, Nov 19 2026). YouTube's Developer
 * Policies (III.E.4) allow data fetched with an API key to be stored for
 * at most 30 days, then it must be refreshed or deleted. The read path
 * refreshes what visitors ask for. This sweep reaches the entries nobody
 * asked for.
 *
 * Each night it takes one slot of the key space: SWEEP_CYCLE_DAYS slots,
 * chosen by a hash of the key. Every entry is therefore visited every 14
 * days. An entry whose YouTube facts are 14 days old or more is re-read
 * then. The worst case is just under 28 days between reads, inside the
 * 30-day limit.
 *
 * Costs only videos.list / channels.list units (the 10,000 bucket),
 * never a search. Relative imports only: bundled into a Netlify function.
 */
import { channelTitles, QuotaError } from '../channelSongs'
import { queueStore, refreshEntry, storeRefreshed, tracksOf } from './cacheEntry'
import { learnedStore, type LearnedChannel } from './learnedChannel'
import type { CachedResolve } from './types'

export const SWEEP_CYCLE_DAYS = 14
const STALE_MS = SWEEP_CYCLE_DAYS * 86_400_000
/** Refreshes per night at most — bounds one night's videos.list spend. */
const MAX_REFRESHES = 1500

export interface SweepReport {
  slot: number
  keysInSlot: number
  refreshed: number
  emptied: number
  channelsChecked: number
  channelsDropped: number
  errors: number
  stoppedEarly: boolean
}

function slotOf(key: string): number {
  let hash = 5381
  for (let i = 0; i < key.length; i++) hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0
  return hash % SWEEP_CYCLE_DAYS
}

export function tonightsSlot(now = Date.now()): number {
  return Math.floor(now / 86_400_000) % SWEEP_CYCLE_DAYS
}

/** artist/{mbid}/{decade} or v2/artist/{mbid}/{decade} → mbid. */
function mbidOf(key: string): string {
  const parts = key.split('/')
  return parts[parts.length - 2] ?? ''
}

const isStale = (stamp: string | undefined, now: number) => !stamp || now - Date.parse(stamp) >= STALE_MS

async function sweepQueue(slot: number, apiKey: string, deadline: number, report: SweepReport): Promise<void> {
  const { blobs } = await queueStore().list()
  const keys = blobs.map((blob) => blob.key).filter((key) => slotOf(key) === slot)
  report.keysInSlot += keys.length
  for (const key of keys) {
    if (Date.now() > deadline || report.refreshed >= MAX_REFRESHES) {
      report.stoppedEarly = true
      return
    }
    const entry = (await queueStore().get(key, { type: 'json' }).catch(() => null)) as CachedResolve | null
    if (!entry || tracksOf(entry).length === 0 || !isStale(entry.checkedAt ?? entry.at, Date.now())) continue
    let fresh: CachedResolve | null
    try {
      fresh = await refreshEntry(entry, mbidOf(key), entry.name ?? '', apiKey)
    } catch {
      // One bad answer (a 5xx, a timeout) skips this key, not the night.
      report.errors += 1
      continue
    }
    if (!fresh) {
      // Quota refusal: stop; tomorrow's slot differs, so the read path and
      // the next cycle cover what was left.
      report.stoppedEarly = true
      return
    }
    await storeRefreshed(key, fresh)
    report.refreshed += 1
    if (tracksOf(fresh).length === 0) report.emptied += 1
  }
}

async function sweepLearned(slot: number, apiKey: string, deadline: number, report: SweepReport): Promise<void> {
  const { blobs } = await learnedStore().list()
  const due: { mbid: string; held: LearnedChannel }[] = []
  for (const { key } of blobs) {
    if (slotOf(key) !== slot) continue
    if (Date.now() > deadline) break
    const held = (await learnedStore().get(key, { type: 'json' }).catch(() => null)) as LearnedChannel | null
    if (held?.channelId && isStale(held.checkedAt ?? held.at, Date.now())) due.push({ mbid: key, held })
  }
  if (due.length === 0) return
  let titles: Map<string, string>
  try {
    titles = await channelTitles(due.map((row) => row.held.channelId), apiKey)
  } catch (error) {
    if (error instanceof QuotaError) report.stoppedEarly = true
    else report.errors += 1
    return
  }
  const now = new Date().toISOString()
  for (const { mbid, held } of due) {
    const title = titles.get(held.channelId)
    report.channelsChecked += 1
    if (!title) {
      await learnedStore().delete(mbid).catch(() => undefined)
      report.channelsDropped += 1
    } else {
      // The read path re-checks the title against the artist's names.
      await learnedStore().setJSON(mbid, { ...held, channelTitle: title, checkedAt: now }).catch(() => undefined)
    }
  }
}

export async function sweepTonight(apiKey: string, deadline: number): Promise<SweepReport> {
  const report: SweepReport = {
    slot: tonightsSlot(),
    keysInSlot: 0,
    refreshed: 0,
    emptied: 0,
    channelsChecked: 0,
    channelsDropped: 0,
    errors: 0,
    stoppedEarly: false,
  }
  await sweepQueue(report.slot, apiKey, deadline, report)
  if (!report.stoppedEarly) await sweepLearned(report.slot, apiKey, deadline, report)
  return report
}
