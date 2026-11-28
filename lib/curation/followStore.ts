/**
 * RETIRED (Nov 28 2026): the old Discover "following" queue — Discover
 * picks the owner wanted roster pages for, kept apart from the owner's
 * account and shown publicly as "Following — pages pending". The owner
 * thought those follows were in their Following; they never were.
 * Discover's Follow is now the ordinary account follow (artists with no
 * page by MusicBrainz id, lib/fans/artistKeys), and the weekly refresh
 * builds at least one page from the owner's page-less follows. This
 * file only lets the one-time move (/api/studio/move-discover-follows)
 * read the queue and empty it — keeping
 * anything it could not place. Netlify Blobs "curation" store.
 */
import { getStore } from '@netlify/blobs'

export interface FollowEntry {
  name: string
  mbid: string
  why?: string
  knownFor?: string
  listenHref?: string
  followedAt: string
  tier: 'on-the-radar'
}

const QUEUE_KEY = 'following'

function store() {
  return getStore({ name: 'curation', consistency: 'strong' })
}

/** The queue; a read that fails THROWS — "empty" must mean empty, never "could not read". */
export async function readQueue(): Promise<FollowEntry[]> {
  const value = await store().get(QUEUE_KEY, { type: 'json' })
  return Array.isArray(value) ? (value as FollowEntry[]) : []
}

/** Keeps only the entries the move could not place (none: the queue is empty). */
export async function writeQueue(entries: readonly FollowEntry[]): Promise<void> {
  await store().setJSON(QUEUE_KEY, entries)
}
