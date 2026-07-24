import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import {
  ROSTER_LENGTH,
  isFresh,
  readLock,
  readProgress,
  readSnapshot,
} from '@/lib/feed/snapshot'

/**
 * Owner-only: read-only visibility into the resumable feed-snapshot
 * rebuild — otherwise entirely opaque (it runs in a background function,
 * self-chains across batches, and nothing public exposes its progress).
 */
export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()

  const [snapshot, progress, lock] = await Promise.all([
    readSnapshot(),
    readProgress(),
    readLock(),
  ])

  return NextResponse.json({
    currentRosterLength: ROSTER_LENGTH,
    snapshot: snapshot
      ? {
          builtAt: snapshot.builtAt,
          rosterLength: snapshot.rosterLength,
          itemCount: snapshot.items.length,
          isFresh: isFresh(snapshot),
        }
      : null,
    progress: progress
      ? {
          date: progress.date,
          cursor: progress.cursor,
          rosterLength: progress.rosterLength,
          itemsSoFar: progress.items.length,
        }
      : null,
    lock: lock
      ? { date: lock.date, ageMs: Date.now() - lock.updatedAt }
      : null,
  })
}
