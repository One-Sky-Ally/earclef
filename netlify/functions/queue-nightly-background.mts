/**
 * The queue's nightly work (owner go, Nov 19 2026), up to 15 minutes:
 *
 * 1. SPEND TODAY'S LEFTOVER SEARCHES. The project has 100 YouTube searches
 *    a day; whatever visitors did not use vanishes at midnight Pacific.
 *    This spends what is left, keeping RESERVE for late-evening visitors,
 *    on the artists visitors' queues were waiting for: the wanted list in
 *    lib/play/queue/searchBudget.ts, most-asked first. Each one goes
 *    through the public queue route with warm=1, so the same resolver,
 *    checks and cache serve tomorrow's visitor.
 * 2. THE 30-DAY SWEEP (lib/play/queue/sweep.ts): tonight's slot of saved
 *    songs and learned channels is re-read so nothing stored is older than
 *    YouTube's 30-day limit.
 * 3. Prune the search log.
 *
 * Triggered by queue-nightly-schedule (two ticks a night). A lock keeps
 * two runs from overlapping. Every run logs one summary line, so the
 * function log reads as the nightly record.
 */
import { getStore } from '@netlify/blobs'
import { clearWanted, pruneLog, searchesToday, wantedArtists } from '../../lib/play/queue/searchBudget'
import { sweepTonight } from '../../lib/play/queue/sweep'

const TAG = 'queue-nightly:'
/** Google's daily cap on search.list for this project (quotas page, Nov 19 2026). */
const DAILY_SEARCH_CAP = 100
/** Searches left untouched for visitors between the run and midnight. */
const RESERVE = 10
const RUN_MS = 13 * 60_000
const LOCK_STALE_MS = 16 * 60_000
const REQUEST_TIMEOUT_MS = 30_000

function locks() {
  return getStore({ name: 'search-budget', consistency: 'eventual' })
}

/** The two ticks are an hour apart, so an eventually consistent lock is enough. */
async function takeLock(): Promise<boolean> {
  try {
    const held = (await locks().get('lock/nightly', { type: 'json' })) as { at: number } | null
    if (held && Date.now() - held.at < LOCK_STALE_MS) return false
    await locks().setJSON('lock/nightly', { at: Date.now() })
  } catch {
    // No lock store: run anyway; the search count still bounds spending.
  }
  return true
}

interface WarmReport {
  budget: number
  asked: number
  searched: number
  answeredFree: number
  stop: string
}

async function spendLeftovers(base: string, deadline: number): Promise<WarmReport> {
  const books = await searchesToday()
  const budget = DAILY_SEARCH_CAP - books.live - books.overnight - RESERVE
  const report: WarmReport = { budget, asked: 0, searched: 0, answeredFree: 0, stop: 'done' }
  if (books.refused > 0) return { ...report, stop: 'cap already reached today' }
  if (budget <= 0) return { ...report, stop: 'no leftovers' }
  const wanted = await wantedArtists(budget * 3)
  for (const artist of wanted) {
    if (report.searched >= budget) return { ...report, stop: 'budget spent' }
    if (Date.now() > deadline) return { ...report, stop: 'time' }
    report.asked += 1
    const url = `${base}/api/queue/artist/${artist.mbid}/${artist.decade}?name=${encodeURIComponent(artist.name)}&search=1&warm=1`
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch {
      continue
    }
    const body = (await res.json().catch(() => ({}))) as { quota?: boolean; searched?: boolean; deferred?: boolean }
    if (body.quota) return { ...report, stop: 'quota' }
    if (!res.ok) continue
    if (body.searched) report.searched += 1
    else {
      // Answered without a search (a cached or free source meanwhile).
      report.answeredFree += 1
      await clearWanted(artist.mbid, artist.decade)
    }
  }
  return report
}

export default async function handler(): Promise<Response> {
  const started = Date.now()
  const deadline = started + RUN_MS
  if (!(await takeLock())) {
    const line = `${TAG} another run holds the lock; nothing to do`
    console.log(line)
    return new Response(line)
  }
  const base = process.env.URL
  const apiKey = process.env.YOUTUBE_API_KEY
  try {
    const warm = base
      ? await spendLeftovers(base, deadline - 4 * 60_000)
      : { budget: 0, asked: 0, searched: 0, answeredFree: 0, stop: 'URL env var not set' }
    const sweep = apiKey ? await sweepTonight(apiKey, deadline) : null
    const pruned = await pruneLog().catch(() => 0)
    const line =
      `${TAG} leftovers ${warm.budget} → searched ${warm.searched}, answered free ${warm.answeredFree}, asked ${warm.asked} (stop: ${warm.stop}); ` +
      (sweep
        ? `sweep slot ${sweep.slot}: ${sweep.keysInSlot} keys, refreshed ${sweep.refreshed}, emptied ${sweep.emptied}, channels ${sweep.channelsChecked}/${sweep.channelsDropped} dropped${sweep.stoppedEarly ? ' (stopped early)' : ''}; `
        : 'sweep skipped (no YOUTUBE_API_KEY); ') +
      `pruned ${pruned} log lines; ${Math.round((Date.now() - started) / 1000)}s`
    console.log(line)
    return new Response(line)
  } catch (error) {
    console.error(`${TAG} failed:`, error)
    return new Response('failed', { status: 500 })
  } finally {
    await locks().delete('lock/nightly').catch(() => undefined)
  }
}
