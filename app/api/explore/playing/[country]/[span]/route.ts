import { NextResponse } from 'next/server'
import { findPlayingEntry, type PlayingEntry } from '@/lib/explore/playing'
import playing from '@/lib/explore/playing.json'

/**
 * "What was playing in [country], [era]" — SERVED FROM THE COMMITTED
 * FILE ONLY. Snapshots are generated in-session in Claude Code against
 * verifiable sources and committed to lib/explore/playing.json; this
 * route never calls a model. 404 = no documented snapshot yet (the
 * panel shows an honest note), never an error state.
 */

const COUNTRY_PATTERN = /^[A-Za-z]{2}$/
const SPAN_PATTERN = /^(\d{4})(?:-(\d{4}))?$/

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ country: string; span: string }> },
) {
  const { country, span } = await ctx.params
  if (!COUNTRY_PATTERN.test(country)) {
    return NextResponse.json({ error: 'Bad country' }, { status: 400 })
  }
  const match = SPAN_PATTERN.exec(span)
  if (!match) {
    return NextResponse.json({ error: 'Bad span' }, { status: 400 })
  }
  const from = Number(match[1])
  const to = match[2] ? Number(match[2]) : from
  if (from > to) {
    return NextResponse.json({ error: 'Bad span' }, { status: 400 })
  }

  const entry = findPlayingEntry(
    (playing as { entries: PlayingEntry[] }).entries,
    country,
    from,
    to,
  )
  if (!entry) {
    const miss = NextResponse.json(
      { error: 'No snapshot yet' },
      { status: 404 },
    )
    // Misses cache briefly only: a 404 cached mid-rollout can outlive
    // the deploy that fixes it (seen in prod July 20, 2026 — GB/2018
    // pinned for the full window on some CDN nodes), so a wrong "no
    // snapshot" must age out in an hour, not a week.
    miss.headers.set(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=3600',
    )
    return miss
  }

  const response = NextResponse.json(entry)
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
