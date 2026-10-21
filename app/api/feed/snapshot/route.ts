import { NextResponse } from 'next/server'
import { isFresh, readSnapshot, triggerRebuild } from '@/lib/feed/snapshot'

/**
 * Serves the precomputed feed. A stale-but-present snapshot is still
 * served (stale releases beat 100 client fetches) while a rebuild is
 * triggered; a missing snapshot returns 404 and the client falls back to
 * live per-artist assembly.
 */
export async function GET() {
  const snapshot = await readSnapshot()

  if (!snapshot || !isFresh(snapshot)) {
    // Awaited, not fire-and-forget: the function can freeze as soon as the
    // response is returned, abandoning an unawaited fetch (the same failure
    // feed-snapshot-background's self-trigger hit). Background functions
    // answer 202 at once, and the timeout keeps a slow one off the request.
    // One attempt only — this is a visitor's request; the hourly tick is
    // the retry.
    const base = process.env.URL
    if (base) {
      await triggerRebuild(base, { attempts: 1, timeoutMs: 3000 })
    }
  }

  if (!snapshot) {
    return NextResponse.json(
      { building: true },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const response = NextResponse.json(snapshot)
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=7200',
  )
  return response
}
