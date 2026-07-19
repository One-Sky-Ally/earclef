import { NextResponse } from 'next/server'
import type { DiscoverPool } from '@/lib/discover/generate'
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
 */

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

export async function GET() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ status: 'disabled' }, 300)
  }

  const today = utcToday()

  const cached = memo.get(today) ?? (await readPool(today))
  if (cached) {
    memo.set(today, cached)
    return json({ status: 'ready', pool: cached }, secondsUntilUtcMidnight())
  }

  if (process.env.NETLIFY === 'true') {
    // No page-load generation: yesterday's pool carries the section until
    // the 00:10 UTC schedule produces today's.
    const stale = await readLatestPool()
    if (stale) return json({ status: 'ready', pool: stale }, 300)
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
