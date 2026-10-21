/**
 * The feed-snapshot tick: every hour at :20 UTC. The rebuild is
 * idempotent per UTC day (isFresh = "built today AND covers the current
 * roster"), so the 00:20 tick starts the night's rebuild and the other 23
 * ticks are one Blobs read that logs "fresh" and exits. Every tick logs
 * exactly one line, so the Netlify function log for this function reads
 * as a record of every night: when the rebuild was triggered, whether
 * Netlify accepted it, and what was stored at the time.
 *
 * WHY HOURLY, NOT ONCE A NIGHT (Oct 21, 2026): the single 00:20 tick had
 * no second chance. Each of these left the snapshot stale for a whole day
 * with nothing in progress to show for it:
 *   - the scheduler running late or not at all (Netlify does not promise
 *     the minute; the Oct 12 tick ran at 00:28);
 *   - the one trigger POST failing or hanging (no retry; its status was
 *     only echoed back, never acted on);
 *   - a visitor-triggered rebuild right after midnight finishing before
 *     the tick, so the tick saw "fresh" and the NEXT rebuild came a full
 *     day later, 24h+ old by the time anyone looked;
 *   - a batch chain dying mid-roster (progress saved, but nothing resumed
 *     it until a lucky /feed visit or the next night, which restarted it
 *     from zero).
 * Hourly, every one of those is caught at the next :20: a stale snapshot
 * is re-triggered and a parked chain resumes from its saved cursor. (The
 * Sep 26 change to a UTC-date freshness rule fixed the 26h-window skip;
 * it did not give the tick a second chance.)
 */
import {
  ROSTER_LENGTH,
  isFresh,
  readLock,
  readProgress,
  readSnapshot,
  triggerRebuild,
} from '../../lib/feed/snapshot'

const TAG = 'feed-snapshot-schedule:'

export default async function handler(): Promise<Response> {
  const [snapshot, progress, lock] = await Promise.all([
    readSnapshot(),
    readProgress(),
    readLock(),
  ])
  const state = snapshot
    ? `snapshot built ${snapshot.builtAt} covering ${snapshot.rosterLength} artists (roster now ${ROSTER_LENGTH})`
    : 'no snapshot stored'

  if (snapshot && isFresh(snapshot)) {
    const line = `${TAG} fresh — ${state}; nothing to do`
    console.log(line)
    return new Response(line)
  }

  const chain = [
    progress
      ? `saved progress ${progress.cursor}/${progress.rosterLength} from ${progress.date}`
      : 'no saved progress',
    lock
      ? `lock ${Math.round((Date.now() - lock.updatedAt) / 1000)}s old`
      : 'no lock',
  ].join(', ')

  const base = process.env.URL
  if (!base) {
    const line = `${TAG} stale — ${state}; ${chain}; NOT triggered: the URL env var is not set for this function`
    console.error(line)
    return new Response(line, { status: 500 })
  }

  // Three quick tries fit inside a scheduled function's own time budget.
  const result = await triggerRebuild(base, { attempts: 3, timeoutMs: 2000 })
  const outcome = result.ok
    ? `triggered the background rebuild (HTTP ${result.status}, attempt ${result.attempts})`
    : `could NOT trigger the background rebuild (last status ${result.status ?? 'no response'} after ${result.attempts} attempts); the next tick tries again`
  const line = `${TAG} stale — ${state}; ${chain}; ${outcome}`
  if (result.ok) console.log(line)
  else console.error(line)
  return new Response(line, { status: result.ok ? 200 : 502 })
}

export const config = {
  schedule: '20 * * * *',
}
