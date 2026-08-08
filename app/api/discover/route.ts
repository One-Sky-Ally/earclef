import { NextResponse } from 'next/server'
import type { DiscoverPick, DiscoverPool } from '@/lib/discover/generate'
import {
  readLatestPool,
  readPool,
  readRecentNames,
} from '@/lib/discover/store'

/**
 * Serves the daily Discover pool. This route only ever READS — generation
 * runs solely in the SCHEDULED background function (00:10 UTC daily); page
 * loads never trigger a model call. A cache miss serves the previous
 * day's pool until the schedule fires. Local dev has no Blobs or
 * background functions, so there — and only there — it generates inline.
 *
 * Pools written before the verified-play change carry search-URL
 * listenHrefs and unverified knownFor titles; sanitizePool() strips
 * both at the door (read-about links only) until the next scheduled
 * generation replaces them with verified data.
 */

/** Legacy picks lack `read`; their listenHref is a search URL. */
function sanitizePool(pool: DiscoverPool): DiscoverPool {
  return {
    ...pool,
    picks: pool.picks.map((pick): DiscoverPick => {
      if (pick.read) return pick
      const mbUrl = `https://musicbrainz.org/artist/${pick.mbid}`
      return {
        name: pick.name,
        why: pick.why,
        knownFor: pick.knownFor,
        knownForVerified: false,
        mbid: pick.mbid,
        play: null,
        read: { kind: 'musicbrainz', url: mbUrl },
        listenHref: mbUrl,
      }
    }),
  }
}

type DiscoverResponse =
  | { status: 'ready'; pool: DiscoverPool }
  | { status: 'warming' }
  | { status: 'disabled' }

const memo = new Map<string, DiscoverPool>()
let devGeneration: Promise<DiscoverPool> | null = null

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

async function devGenerate(today: string): Promise<DiscoverPool> {
  // Inline generation for local dev only — no function timeout applies.
  const { generatePool } = await import('@/lib/discover/generate')
  devGeneration ??= generatePool(today, await readRecentNames(today)).finally(
    () => {
      devGeneration = null
    },
  )
  return devGeneration
}

/** Dev-only pool fixture: verify rendering with zero model calls. */
async function readFixture(): Promise<DiscoverPool | null> {
  const path = process.env.DISCOVER_FIXTURE
  if (!path || process.env.NETLIFY === 'true') return null
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(path, 'utf8')) as DiscoverPool
  } catch (error) {
    console.error('Discover fixture unreadable:', error)
    return null
  }
}

export async function GET() {
  const fixture = await readFixture()
  if (fixture) {
    return json({ status: 'ready', pool: sanitizePool(fixture) }, 60)
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ status: 'disabled' }, 300)
  }

  const today = utcToday()

  const cached = memo.get(today) ?? (await readPool(today))
  if (cached) {
    const pool = sanitizePool(cached)
    memo.set(today, pool)
    return json({ status: 'ready', pool }, secondsUntilUtcMidnight())
  }

  if (process.env.NETLIFY === 'true') {
    // No page-load generation: yesterday's pool carries the section until
    // the 00:10 UTC schedule produces today's.
    const stale = await readLatestPool()
    if (stale) return json({ status: 'ready', pool: sanitizePool(stale) }, 300)
    return json({ status: 'warming' }, 60)
  }

  try {
    const pool = await devGenerate(today)
    memo.set(today, pool)
    return json({ status: 'ready', pool }, secondsUntilUtcMidnight())
  } catch (error) {
    console.error('Discover dev generation failed:', error)
    return NextResponse.json(
      { error: 'Generation failed' },
      { status: 502 },
    )
  }
}
