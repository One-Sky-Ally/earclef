/**
 * The "following" queue — Discover picks the owner wants roster pages for.
 * Durable copy lives in Netlify Blobs; local dev (no Blobs context) falls
 * back to an in-process array so the flow is testable end-to-end.
 */
import { getStore } from '@netlify/blobs'

export interface FollowEntry {
  name: string
  mbid: string
  why?: string
  knownFor?: string
  listenHref?: string
  followedAt: string
  /** Tier the artist's page starts at when it gets built. */
  tier: 'on-the-radar'
}

const QUEUE_KEY = 'following'

let devQueue: FollowEntry[] = []

function store() {
  return getStore({ name: 'curation', consistency: 'strong' })
}

export async function readQueue(): Promise<FollowEntry[]> {
  try {
    return ((await store().get(QUEUE_KEY, { type: 'json' })) ??
      []) as FollowEntry[]
  } catch {
    return devQueue
  }
}

async function writeQueue(entries: FollowEntry[]): Promise<void> {
  try {
    await store().setJSON(QUEUE_KEY, entries)
  } catch {
    devQueue = entries
  }
}

/** Adds an entry unless the MBID is already queued. Returns the queue. */
export async function addFollow(entry: FollowEntry): Promise<FollowEntry[]> {
  const queue = await readQueue()
  if (queue.some((existing) => existing.mbid === entry.mbid)) return queue
  const next = [...queue, entry]
  await writeQueue(next)
  return next
}

export async function removeFollow(mbid: string): Promise<FollowEntry[]> {
  const queue = await readQueue()
  const next = queue.filter((entry) => entry.mbid !== mbid)
  if (next.length !== queue.length) await writeQueue(next)
  return next
}
