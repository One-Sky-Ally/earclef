import { NextResponse } from 'next/server'
import { onThisDay } from '@/lib/explore/onThisDay'

/**
 * Music released on one calendar day in past years ("MM-DD"), served from
 * the committed dataset (scripts/build-on-this-day.mjs) — no external
 * calls. Only exact release dates; an empty day returns total 0, never
 * a guess. Long CDN cache: the data changes only when a deploy does.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params
  const payload = await onThisDay(date)
  if (!payload) {
    return NextResponse.json({ error: 'Not a calendar day (use MM-DD)' }, { status: 400 })
  }
  const response = NextResponse.json(payload)
  response.headers.set('Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=604800')
  return response
}
