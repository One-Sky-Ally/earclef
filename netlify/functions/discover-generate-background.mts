/**
 * Generates the day's Discover pool: one Claude call + MusicBrainz
 * verification (~30s total — the "-background" suffix gives this a
 * 15-minute budget, so nothing here races a timeout).
 *
 * Idempotent by design: if today's pool already exists, or another
 * invocation holds today's generation lock, it exits immediately — spam
 * against this endpoint can't stack model calls.
 */
import { generatePool } from '../../lib/discover/generate'
import {
  appendHistory,
  claimGeneration,
  readPool,
  readRecentNames,
  writePool,
} from '../../lib/discover/store'

export default async function handler(): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('disabled', { status: 200 })
  }

  const today = new Date().toISOString().slice(0, 10)

  if (await readPool(today)) return new Response('already generated')
  if (!(await claimGeneration(today))) return new Response('already running')

  try {
    const pool = await generatePool(today, await readRecentNames(today))
    await writePool(pool)
    await appendHistory(pool)
    console.log(`discover: generated ${pool.picks.length} picks for ${today}`)
    return new Response('generated')
  } catch (error) {
    console.error('discover generation failed:', error)
    return new Response('failed', { status: 500 })
  }
}
