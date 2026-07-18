import { NextResponse } from 'next/server'
import { publishedCards } from '@/lib/stories/store'

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/

/** Published story cards for one artist — the "Story & Press" section. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }
  const cards = await publishedCards(slug)
  const response = NextResponse.json({ cards })
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  )
  return response
}
