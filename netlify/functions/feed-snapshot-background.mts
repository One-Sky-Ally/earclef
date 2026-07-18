/**
 * Builds the precomputed feed snapshot: one polite pass over the whole
 * roster (MusicBrainz + iTunes + YouTube RSS, ~4-5 min sequential) into
 * the Blobs "feed" store. The "-background" suffix grants the 15-minute
 * budget. Idempotent: a fresh snapshot or a held date-lock exits early.
 */
import { getStore } from '@netlify/blobs'
import {
  buildSnapshot,
  isFresh,
  readSnapshot,
  writeSnapshot,
} from '../../lib/feed/snapshot'

const LOCK_KEY = 'build-lock'

async function claimBuild(date: string): Promise<boolean> {
  try {
    const store = getStore({ name: 'feed', consistency: 'strong' })
    const current = (await store.get(LOCK_KEY, { type: 'text' })) as
      | string
      | null
    if (current === date) return false
    await store.set(LOCK_KEY, date)
    return true
  } catch {
    return true
  }
}

export default async function handler(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10)

  const existing = await readSnapshot()
  if (existing && isFresh(existing)) return new Response('already fresh')
  if (!(await claimBuild(today))) return new Response('already running')

  try {
    const snapshot = await buildSnapshot()
    await writeSnapshot(snapshot)
    console.log(`feed snapshot: ${snapshot.items.length} items`)
    return new Response('built')
  } catch (error) {
    console.error('feed snapshot build failed:', error)
    return new Response('failed', { status: 500 })
  }
}
