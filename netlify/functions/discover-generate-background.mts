/**
 * Generates one of the day's Discover pools: one Claude call +
 * MusicBrainz/Discogs/YouTube verification (minutes — the "-background"
 * suffix gives this a 15-minute budget). `?pool=owner` makes the
 * owner's own pool from their rows; anything else makes the shared pool
 * every visitor sees, from the whole roster. The two run at different
 * times (see the schedules) so they never share the MusicBrainz and
 * Discogs rate limits.
 *
 * Idempotent by design: if that pool already exists for today, or
 * another invocation holds its generation lock, it exits immediately —
 * spam against this endpoint can't stack model calls.
 */
import { generatePool } from '../../lib/discover/generate'
import { ownerLibrary, sharedLibrary, type PoolKind } from '../../lib/discover/library'
import {
  appendHistory,
  claimGeneration,
  readPool,
  readRecentNames,
  writePool,
} from '../../lib/discover/store'

export default async function handler(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('disabled', { status: 200 })
  }

  const kind: PoolKind =
    new URL(request.url).searchParams.get('pool') === 'owner' ? 'owner' : 'shared'
  const today = new Date().toISOString().slice(0, 10)

  if (await readPool(today, kind)) return new Response('already generated')
  if (!(await claimGeneration(today, kind))) return new Response('already running')

  try {
    const { library, source } =
      kind === 'owner'
        ? await ownerLibrary()
        : { library: sharedLibrary(), source: 'roster' }
    const pool = await generatePool(today, await readRecentNames(today, kind), library)
    await writePool(pool, kind)
    await appendHistory(pool, kind)
    const withSongs = pool.picks.filter((pick) => pick.song !== null).length
    console.log(
      `discover (${kind}, from ${source}): generated ${pool.picks.length} picks for ${today} (${withSongs} with a song)`,
    )
    return new Response('generated')
  } catch (error) {
    console.error(`discover ${kind} generation failed:`, error)
    return new Response('failed', { status: 500 })
  }
}
