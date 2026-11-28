import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/curation/auth'
import { collectPastPicks, ownerPastDays, sharedPastDays, type PastSetDay } from '@/lib/discover/past'
import { playablePicks, readFixture, sanitizePool } from '@/lib/discover/serve'
import { readIndex, readSets } from '@/lib/discover/stockStore'
import type { DiscoverPick } from '@/lib/discover/types'
import { withPageSlugs } from '@/lib/discover/pages'

/**
 * Every artist Discover has recommended, newest first (lib/discover/past):
 * the shared sets shown so far and, with the owner key, the owner's own
 * sets too (the page asks with `?own=1`, so a CDN copy of the public
 * answer is never handed to the owner). Read-only — it never advances the owner's set of the day.
 * Whether the listener has played each artist is NOT here: that list
 * lives only in the listener's own browser (lib/discover/played.ts).
 * A past pick who has since got an Ear Clef page carries its `slug`
 * (./pages), so the card's Follow follows the page.
 */
function withPages<T extends { pick: { mbid: string } }>(artists: T[]): (T & { slug?: string })[] {
  const slugs = withPageSlugs(artists.map((artist) => artist.pick))
  return artists.map((artist, i) => (slugs[i].slug ? { ...artist, slug: slugs[i].slug } : artist))
}

function json(body: unknown, privateAnswer: boolean): NextResponse {
  const response = NextResponse.json(body)
  response.headers.set(
    'Cache-Control',
    privateAnswer ? 'private, no-store' : 'public, s-maxage=900, stale-while-revalidate=43200',
  )
  return response
}

export async function GET(request: Request) {
  const asksOwn = new URL(request.url).searchParams.get('own') === '1'
  const owner = asksOwn && isOwner(request)
  const today = new Date().toISOString().slice(0, 10)

  // Dev only: the fixtures stand in for today's sets.
  const fixture = await readFixture(process.env.DISCOVER_FIXTURE)
  if (fixture) {
    const days: PastSetDay[] = [{ date: today, id: 'fixture', source: 'shared' }]
    const sets = new Map([['fixture', playablePicks(sanitizePool(fixture).picks)]])
    const ownFixture = owner ? await readFixture(process.env.DISCOVER_OWNER_FIXTURE) : null
    if (ownFixture) {
      days.push({ date: today, id: 'own-fixture', source: 'own' })
      sets.set('own-fixture', playablePicks(sanitizePool(ownFixture).picks))
    }
    return json({ status: 'ready', since: today, artists: withPages(collectPastPicks(days, sets)) }, asksOwn)
  }

  const days = [
    ...sharedPastDays(await readIndex('shared'), today),
    ...(owner ? ownerPastDays(await readIndex('owner'), today) : []),
  ]
  const sets = await readSets(days.map((day) => day.id))
  const picksBySet = new Map<string, DiscoverPick[]>(
    sets.map((set) => [set.id, playablePicks(set.picks)]),
  )
  const kept = days.filter((day) => picksBySet.has(day.id))
  const since = kept.reduce<string | null>(
    (oldest, day) => (oldest === null || day.date < oldest ? day.date : oldest),
    null,
  )
  return json({ status: 'ready', since, artists: withPages(collectPastPicks(kept, picksBySet)) }, asksOwn)
}
