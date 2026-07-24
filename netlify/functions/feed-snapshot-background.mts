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
 * Idempotent: a fresh snapshot exits early; a heartbeat lock (not a
 * once-per-day flag) prevents two invocations racing the same batch
 * while still letting a dead invocation be reclaimed after LOCK_STALE_MS.
 */
import { getStore } from '@netlify/blobs'
import {
  buildBatch,
  clearProgress,
  finalizeSnapshot,
  isFresh,
  readProgress,
  readSnapshot,
  startProgress,
  writeProgress,
  writeSnapshot,
} from '../../lib/feed/snapshot'

const LOCK_KEY = 'build-lock/v1'
/**
 * Longer than one batch's realistic worst case (BATCH_SIZE artists with
 * MusicBrainz/iTunes/YouTube retries), short enough that a genuinely-dead
 * invocation doesn't stall the rebuild for long before being reclaimed.
 */
const LOCK_STALE_MS = 8 * 60 * 1000

interface Lock {
  date: string
  updatedAt: number
}

function blobStore() {
  return getStore({ name: 'feed', consistency: 'strong' })
}

async function claimLock(today: string): Promise<boolean> {
  try {
    const store = blobStore()
    const current = (await store.get(LOCK_KEY, { type: 'json' })) as Lock | null
    if (
      current &&
      current.date === today &&
      Date.now() - current.updatedAt < LOCK_STALE_MS
    ) {
      return false
    }
    await store.setJSON(LOCK_KEY, { date: today, updatedAt: Date.now() })
    return true
  } catch {
    return true
  }
}

async function releaseLock(): Promise<void> {
  try {
    await blobStore().delete(LOCK_KEY)
  } catch {
    // best effort — a stale lock still self-heals via LOCK_STALE_MS
  }
}

function triggerNextBatch(): void {
  const base = process.env.URL
  if (!base) return
  fetch(`${base}/.netlify/functions/feed-snapshot-background`, {
    method: 'POST',
  }).catch(() => {})
}

export default async function handler(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10)

  const existing = await readSnapshot()
  if (existing && isFresh(existing)) return new Response('already fresh')
  if (!(await claimLock(today))) return new Response('already running')

  let done = false
  let cursor = 0
  let rosterLength = 0
  try {
    let progress = await readProgress()
    if (!progress || progress.date !== today) progress = startProgress()

    const batch = await buildBatch(progress)
    await writeProgress(batch.progress)
    done = batch.done
    cursor = batch.progress.cursor
    rosterLength = batch.progress.rosterLength

    if (done) {
      const snapshot = finalizeSnapshot(batch.progress)
      await writeSnapshot(snapshot)
      await clearProgress()
      console.log(`feed snapshot: ${snapshot.items.length} items`)
    }
  } catch (error) {
    console.error('feed snapshot batch failed:', error)
    await releaseLock()
    return new Response('failed', { status: 500 })
  }

  await releaseLock()
  if (!done) {
    triggerNextBatch()
    return new Response(`batch progress: ${cursor}/${rosterLength}`)
  }
  return new Response('built')
}
