import { NextResponse } from 'next/server'
import { journeyById } from '@/lib/explore/cultures'

/**
 * One curated journey with its songs — SERVED FROM THE COMMITTED FILE
 * ONLY (lib/explore/cultures.json, written at build time by
 * scripts/build-cultures.mjs from data the site already verified).
 * Every song in it plays on the site.
 */
const ID_PATTERN = /^[A-Z]{2}-(\d{4}-\d{4}|\d{4}s)$/

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Bad journey id' }, { status: 400 })
  }
  const journey = journeyById(id)
  if (!journey) {
    const miss = NextResponse.json({ error: 'No such journey' }, { status: 404 })
    miss.headers.set('Cache-Control', 'public, s-maxage=600')
    return miss
  }
  const response = NextResponse.json(journey)
  // Rebuilt with every deploy; an hour at the edge, then revalidate.
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  )
  return response
}
