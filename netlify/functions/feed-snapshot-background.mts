/**
 * Builds the precomputed feed snapshot: MusicBrainz + iTunes + YouTube RSS
 * for the whole roster, into the Blobs "feed" store. RESUMABLE/BATCHED:
 * each invocation fetches one bounded slice of the roster (BATCH_SIZE
 * artists), persists progress, then self-triggers the next slice — so a
 * full pass completes across several chained invocations instead of
 * needing to finish inside one 15-minute background-function budget.
 * (A sequential single-pass over the whole roster used to stall past
 * ~60 artists as the roster grew — this replaces that.)
 *
 * Idempotent: a fresh snapshot exits early; a heartbeat lock (refreshed
 * after every artist, not a once-per-day flag) prevents two invocations
 * racing the same batch while still letting a genuinely dead invocation
 * be reclaimed after LOCK_STALE_MS.
 *
 * Triggered by: the hourly feed-snapshot-schedule tick (the 00:20 UTC
 * one starts the night's rebuild, later ones resume a parked chain), the
 * previous batch's self-trigger, and /api/feed/snapshot on a stale read.
 */
import {
  buildBatch,
  clearLock,
  clearProgress,
  finalizeSnapshot,
  isFresh,
  readLock,
  readProgress,
  readSnapshot,
  startProgress,
  triggerRebuild,
  writeLock,
  writeProgress,
  writeSnapshot,
} from '../../lib/feed/snapshot'

/**
 * Longer than the gap between two heartbeats (one artist's fetches with
 * MusicBrainz/iTunes/YouTube retries), short enough that a genuinely-dead
 * invocation doesn't stall the rebuild for long before being reclaimed.
 */
const LOCK_STALE_MS = 8 * 60 * 1000

async function claimLock(today: string): Promise<boolean> {
  const current = await readLock()
  if (
    current &&
    current.date === today &&
    Date.now() - current.updatedAt < LOCK_STALE_MS
  ) {
    return false
  }
  await writeLock({ date: today, updatedAt: Date.now() })
  return true
}

/**
 * MUST be awaited by the caller. A fire-and-forget fetch here is not
 * safe: Netlify's background functions run on Lambda, and the execution
 * environment can freeze right after the handler returns — an unawaited
 * self-trigger can be abandoned mid-dispatch, which is exactly what
 * silently stalled the very first verification of this rebuild (progress
 * persisted correctly at cursor 15/87, but the chain never continued).
 *
 * Retried (triggerRebuild): a single dropped POST used to park the chain
 * until the next trigger. If every attempt fails, progress is already
 * saved and the hourly tick resumes the chain from its cursor.
 */
async function triggerNextBatch(): Promise<void> {
  const base = process.env.URL
  if (!base) {
    console.error(
      'feed snapshot: URL env var not set, cannot self-trigger; the hourly tick resumes from saved progress',
    )
    return
  }
  const result = await triggerRebuild(base, { attempts: 3, timeoutMs: 5000 })
  if (!result.ok) {
    console.error(
      `feed snapshot: next batch not accepted (last status ${result.status ?? 'no response'} after ${result.attempts} attempts); the hourly tick resumes from saved progress`,
    )
  }
}

export default async function handler(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10)

  const existing = await readSnapshot()
  if (existing && isFresh(existing)) {
    console.log(`feed snapshot: already fresh (built ${existing.builtAt})`)
    return new Response('already fresh')
  }
  if (!(await claimLock(today))) {
    console.log('feed snapshot: already running (lock held by another batch)')
    return new Response('already running')
  }

  let done = false
  let cursor = 0
  let rosterLength = 0
  try {
    let progress = await readProgress()
    if (!progress || progress.date !== today) progress = startProgress()
    console.log(`feed snapshot: batch starting at ${progress.cursor}/${progress.rosterLength}`)

    const batch = await buildBatch(progress, {
      heartbeat: () => writeLock({ date: today, updatedAt: Date.now() }),
    })
    await writeProgress(batch.progress)
    done = batch.done
    cursor = batch.progress.cursor
    rosterLength = batch.progress.rosterLength
    console.log(`feed snapshot: batch finished, now at ${cursor}/${rosterLength}`)

    if (done) {
      const snapshot = finalizeSnapshot(batch.progress)
      await writeSnapshot(snapshot)
      await clearProgress()
      console.log(`feed snapshot: ${snapshot.items.length} items`)
    }
  } catch (error) {
    console.error('feed snapshot batch failed:', error)
    await clearLock()
    return new Response('failed', { status: 500 })
  }

  await clearLock()
  if (!done) {
    await triggerNextBatch()
    return new Response(`batch progress: ${cursor}/${rosterLength}`)
  }
  return new Response('built')
}
