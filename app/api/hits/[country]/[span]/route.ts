import { NextResponse } from 'next/server'
import { hitsFor } from '@/lib/hits/hits'

/**
 * This year's #1 hits for a place — served entirely from the committed
 * chart datasets (no external calls, milliseconds for any span).
 * 404 means "no authoritative chart covers this place/era": the panel
 * section renders nothing, per the strict-sourcing gate.
 *
 * Long CDN cache: the data changes only when a deploy refreshes the
 * dataset, and deploys purge the CDN.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ country: string; span: string }> },
) {
  const { country, span } = await ctx.params
  if (!/^[A-Z]{2}$/.test(country) || !/^\d{4}(-\d{4})?$/.test(span)) {
    return NextResponse.json({ error: 'Invalid place or span' }, { status: 400 })
  }
  const [startRaw, endRaw = startRaw] = span.split('-')
  const start = Number(startRaw)
  const end = Number(endRaw)
  if (start < 1900 || end > 2100 || start > end) {
    return NextResponse.json({ error: 'Span out of range' }, { status: 400 })
  }

  const payload = hitsFor(country, start, end)
  const response = payload
    ? NextResponse.json(payload)
    : NextResponse.json({ error: 'No authoritative chart' }, { status: 404 })
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
