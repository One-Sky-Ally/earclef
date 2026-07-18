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
    // Fire-and-forget rebuild; never block the request on it.
    const base = process.env.URL
    if (base) {
      fetch(`${base}/.netlify/functions/feed-snapshot-background`, {
        method: 'POST',
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
