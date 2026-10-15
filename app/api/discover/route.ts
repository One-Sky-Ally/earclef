import { NextResponse } from 'next/server'
import { readFixture, sanitizePool } from '@/lib/discover/serve'
import { sharedSetFor } from '@/lib/discover/stock'
import { readIndex, readSet } from '@/lib/discover/stockStore'
import { readLatestLegacyPool } from '@/lib/discover/store'
import { VISITOR_PICKS, type DiscoverPool } from '@/lib/discover/types'

/**
 * The SHARED Discover set of the day — what every visitor sees. Picks
 * are stocked during /refresh-earclef (no model call anywhere on the
 * site, owner ruling Oct 15 2026) and rotate one set a day; when the
 * stock runs out, earlier sets come back labelled "from the archive".
 * Before the first stocked set exists, the last pool the retired
 * nightly job wrote fills the row, also as the archive — the row is
 * never empty through the switchover.
 */

type DiscoverResponse =
  | { status: 'ready'; pool: DiscoverPool; archive: boolean }
  | { status: 'warming' }

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function secondsUntilUtcMidnight(): number {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setUTCHours(24, 0, 0, 0)
  return Math.max(60, Math.floor((midnight.getTime() - now.getTime()) / 1000))
}

function json(body: DiscoverResponse, maxAge: number): NextResponse {
  const response = NextResponse.json(body)
  response.headers.set(
    'Cache-Control',
    `public, s-maxage=${maxAge}, stale-while-revalidate=43200`,
  )
  return response
}

const forVisitors = (pool: DiscoverPool): DiscoverPool => ({
  date: pool.date,
  picks: pool.picks.slice(0, VISITOR_PICKS),
})

export async function GET() {
  const fixture = await readFixture(process.env.DISCOVER_FIXTURE)
  if (fixture) {
    return json({ status: 'ready', pool: forVisitors(sanitizePool(fixture)), archive: false }, 60)
  }

  const today = utcToday()
  const todays = sharedSetFor(await readIndex('shared'), today)
  const set = todays ? await readSet(todays.id) : null
  if (todays && set && set.picks.length > 0) {
    return json(
      {
        status: 'ready',
        pool: forVisitors({ date: today, picks: set.picks }),
        archive: todays.archive,
      },
      secondsUntilUtcMidnight(),
    )
  }

  // Switchover: nothing stocked yet — the nightly job's last pool, as
  // the archive, re-checked often so the first stocked set shows soon.
  const legacy = await readLatestLegacyPool()
  if (legacy && legacy.picks.length > 0) {
    return json(
      {
        status: 'ready',
        pool: forVisitors(sanitizePool(legacy)),
        archive: legacy.date !== today,
      },
      300,
    )
  }
  return json({ status: 'warming' }, 60)
}
