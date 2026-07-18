import { NextResponse } from 'next/server'
import { publishedCards } from '@/lib/stories/store'

/** All published story cards — the feed pulls these in as entries. */
export async function GET() {
  const cards = await publishedCards()
  const response = NextResponse.json({ cards })
  // Approvals should surface within the hour; the cards themselves never
  // change (generated once, cached forever in the repo).
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  )
  return response
}
