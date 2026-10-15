import { NextResponse } from 'next/server'
import roster from '@/lib/discover/roster.json'
import { VISITOR_PICKS, type DiscoverPick, type DiscoverPool } from '@/lib/discover/generate'
import { picksForRows } from '@/lib/discover/match'
import { readFixture, sanitizePool } from '@/lib/discover/serve'
import { readPool } from '@/lib/discover/store'
import { getFan } from '@/lib/fans/store'
import { sessionEmail } from '@/lib/membership/session'
import { followTiers } from '@/lib/tiers'

/**
 * A signed-in listener's Discover picks — no model call of their own
 * (owner, Oct 15 2026): from the last week of SHARED sets, the picks
 * connected (by roster slug) to artists in the listener's rows,
 * strongest row first, then today's shared picks to fill the row.
 * Visitors get {status: 'visitor'} and the page shows the shared picks.
 */

const WINDOW_DAYS = 7
const nameBySlug = new Map(roster.map((artist) => [artist.slug, artist.name]))

function noStore(body: unknown): NextResponse {
  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

async function recentSharedPools(): Promise<DiscoverPool[]> {
  // Dev only: the fixture stands in for today's shared set.
  const fixture = await readFixture(process.env.DISCOVER_FIXTURE)
  if (fixture) return [sanitizePool(fixture)]
  const pools = await Promise.all(
    Array.from({ length: WINDOW_DAYS }, (_, days) => readPool(isoDaysAgo(days))),
  )
  return pools.filter((pool): pool is DiscoverPool => pool !== null).map(sanitizePool)
}

export async function GET(request: Request) {
  const email = sessionEmail(request)
  if (!email) return noStore({ status: 'visitor' })

  const fan = await getFan(email)
  const tiers = followTiers(fan?.follows ?? [], fan?.tiers)
  if (Object.keys(tiers).length === 0) return noStore({ status: 'no-follows' })

  const pools = await recentSharedPools()
  if (pools.length === 0) return noStore({ status: 'none' })

  const matches = picksForRows(pools, tiers, VISITOR_PICKS)
  if (matches.length === 0) return noStore({ status: 'no-matches' })

  const taken = new Set(matches.map((match) => match.pick.mbid))
  const filler: DiscoverPick[] = pools[0].picks
    .slice(0, VISITOR_PICKS)
    .filter((pick) => !taken.has(pick.mbid))
    .slice(0, Math.max(0, VISITOR_PICKS - matches.length))

  return noStore({
    status: 'ready',
    matched: matches.length,
    picks: [
      ...matches.map(({ pick, because }) => ({
        ...pick,
        because: because.map((slug) => nameBySlug.get(slug) ?? slug),
      })),
      ...filler,
    ],
  })
}
