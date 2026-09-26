import { NextResponse } from 'next/server'
import { isFresh, readSnapshot } from '@/lib/feed/snapshot'

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
    const base = process.env.URL
    if (base) {
      await fetch(`${base}/.netlify/functions/feed-snapshot-background`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      }).catch(() => {})
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
