import { NextResponse } from 'next/server'
import roster from '@/lib/discover/roster.json'
import { picksForRows } from '@/lib/discover/match'
import { readFixture, sanitizePool } from '@/lib/discover/serve'
import { recentSharedIds } from '@/lib/discover/stock'
import { readIndex, readSets } from '@/lib/discover/stockStore'
import { VISITOR_PICKS, type DiscoverPick, type DiscoverPool } from '@/lib/discover/types'
import { getFan } from '@/lib/fans/store'
import { sessionEmail } from '@/lib/membership/session'
import { followTiers } from '@/lib/tiers'

/**
 * A signed-in listener's Discover picks — no model call of their own
 * (owner, Oct 15 2026): from the last two weeks of SHARED sets, the picks
 * connected (by roster slug) to artists in the listener's rows,
 * strongest row first, then today's shared picks to fill the row.
 * Visitors get {status: 'visitor'} and the page shows the shared picks.
 */

/** Two weeks of shared sets of 12 — enough for matches without bigger sets. */
const WINDOW_DAYS = 14
const nameBySlug = new Map(roster.map((artist) => [artist.slug, artist.name]))

function noStore(body: unknown): NextResponse {
  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function recentSharedPools(): Promise<DiscoverPool[]> {
  // Dev only: the fixture stands in for today's shared set.
  const fixture = await readFixture(process.env.DISCOVER_FIXTURE)
  if (fixture) return [sanitizePool(fixture)]
  const today = new Date().toISOString().slice(0, 10)
  const ids = recentSharedIds(await readIndex('shared'), today, WINDOW_DAYS)
  const sets = await readSets(ids)
  // Keep today-first order: readSets preserves the ids' order.
  return sets.map((set) => ({ date: today, picks: set.picks }))
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
