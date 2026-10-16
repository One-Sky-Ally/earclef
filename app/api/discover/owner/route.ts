import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { playablePicks, readFixture, sanitizePool } from '@/lib/discover/serve'
import { ownerSetFor } from '@/lib/discover/stock'
import { deleteSets, readIndex, readSet, writeIndex } from '@/lib/discover/stockStore'

/**
 * The OWNER's own Discover picks: sets of 8 stocked during
 * /refresh-earclef from the rows in the owner's linked account. The
 * first visit of a day takes the next unseen set; later visits that day
 * see the same one; seen sets are remembered. When the list runs out
 * this answers {status: 'none'} and the page shows the shared picks
 * until the next refresh. Owner key only, never cached.
 */
function privateJson(body: unknown): NextResponse {
  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()

  const fixture = await readFixture(process.env.DISCOVER_OWNER_FIXTURE)
  if (fixture) {
    const pool = sanitizePool(fixture)
    return privateJson({ status: 'ready', pool: { ...pool, picks: playablePicks(pool.picks) }, ready: 0 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const result = ownerSetFor(await readIndex('owner'), today)
  if (result.changed && result.index) {
    await writeIndex('owner', result.index)
    if (result.evicted.length > 0) await deleteSets(result.evicted)
  }
  const set = result.id ? await readSet(result.id) : null
  const picks = set ? playablePicks(set.picks) : []
  if (picks.length === 0) return privateJson({ status: 'none' })
  return privateJson({
    status: 'ready',
    pool: { date: today, picks },
    ready: result.index?.queue.length ?? 0,
  })
}
