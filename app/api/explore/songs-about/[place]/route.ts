import { NextResponse } from 'next/server'
import { PLACE_KEY, songsAboutPlace } from '@/lib/explore/songsAbout'

/**
 * Songs written about a place — SERVED FROM THE COMMITTED FILE ONLY
 * (lib/explore/songs-about-places.json, written by the local sweep).
 * Every song carries a playability-checked video; 404 means the sweep
 * found nothing it can play here, and the panel renders nothing.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ place: string }> },
) {
  const { place } = await ctx.params
  if (!PLACE_KEY.test(place)) {
    return NextResponse.json({ error: 'Bad place' }, { status: 400 })
  }
  const payload = songsAboutPlace(place)
  if (!payload) {
    const miss = NextResponse.json({ error: 'No songs yet' }, { status: 404 })
    miss.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600')
    return miss
  }
  const response = NextResponse.json(payload)
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
