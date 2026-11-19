import { NextResponse } from 'next/server'
import { queueCacheKey } from '@/lib/play/resolve'
import { matchKey } from '@/lib/play/artistMatch'
import { QuotaError } from '@/lib/play/channelSongs'
import { RG_DATING_VERSION, rgDatingFor } from '@/lib/explore/rgDating'
import { GATE_PASS, MATCH_VERSION, PROMO_CHECK, readCached, writeEntry } from '@/lib/play/queue/cacheEntry'
import { resolveArtist } from '@/lib/play/queue/resolveArtist'
import { clearWanted, markWanted } from '@/lib/play/queue/searchBudget'
import type { CachedResolve, QueueTrack } from '@/lib/play/queue/types'

export type { QueueTrack }

/**
 * Play-queue resolver endpoint: ONE artist × decade → their era-ranked,
 * verified songs (lib/play/queue/resolveArtist.ts does the work).
 *
 * THE SEARCH BUDGET (owner go, Nov 19 2026). The project may run 100
 * YouTube searches a day, shared by every visitor, so:
 *   ?search=0  free sources only (cache, the artist's channel, Discogs
 *              leads). An artist only a search could answer comes back
 *              { deferred: true }, uncached by the CDN and listed as
 *              wanted for the overnight job. The player walks the whole
 *              place this way first.
 *   ?search=1  a search may be spent when nothing free answers. The
 *              player allows a few per visit, only while its queue is
 *              short. Absent means 1, for older clients.
 *   &warm=1    the overnight job's requests, counted apart.
 *
 * Answers are cached in Blobs (lib/play/queue/cacheEntry.ts): found songs
 * until their 30-day refresh drops them, "nothing found" for 180 days.
 * The CDN holds an answer for at most 8 days, so a copy there never
 * outlives YouTube's 30-day limit on stored API data. Daily-limit
 * refusals answer { quota: true } and are never cached.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DECADE = /^(19|20)\d0$/

function answer(tracks: QueueTrack[], extra: { searched?: boolean } = {}): NextResponse {
  const response = NextResponse.json({ track: tracks[0] ?? null, tracks, ...extra })
  response.headers.set('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400')
  return response
}

function deferred(): NextResponse {
  const response = NextResponse.json({ track: null, tracks: [], deferred: true })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request, ctx: { params: Promise<{ mbid: string; decade: string }> }) {
  const { mbid, decade } = await ctx.params
  const params = new URL(request.url).searchParams
  const name = params.get('name')?.trim() ?? ''
  if (!UUID.test(mbid) || !DECADE.test(decade) || !name || name.length > 200) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const allowSearch = params.get('search') !== '0'
  const warm = params.get('warm') === '1'
  const key = queueCacheKey(mbid, decade, name)
  const apiKey = process.env.YOUTUBE_API_KEY

  // ~35 KB shard, cached per warm process — validity depends on it.
  const dating = await rgDatingFor(mbid)
  const verdict = await readCached({
    key,
    mbid,
    name,
    allowSearch,
    redatedVersion: dating ? RG_DATING_VERSION : null,
    apiKey,
  })
  if (verdict.kind === 'serve') return answer(verdict.tracks)
  if (verdict.kind === 'deferred') {
    await markWanted(mbid, decade, name)
    return deferred()
  }
  if (!apiKey) return NextResponse.json({ error: 'Queue unavailable' }, { status: 501 })

  const stamp = { name, pass: GATE_PASS, promo: PROMO_CHECK, cv: RG_DATING_VERSION, mv: MATCH_VERSION }
  try {
    const result = await resolveArtist({
      mbid,
      decade: Number(decade),
      name,
      allowSearch,
      searchKind: warm ? 'w' : 's',
      apiKey,
      dating,
      titleKey: matchKey,
    })
    const now = new Date().toISOString()
    if (result.needsSearch) {
      await writeEntry(key, { at: now, track: null, tracks: [], needsSearch: true, ...stamp } satisfies CachedResolve)
      await markWanted(mbid, decade, name)
      return deferred()
    }
    await writeEntry(key, {
      at: now,
      checkedAt: now,
      track: result.tracks[0] ?? null,
      tracks: result.tracks,
      searched: result.searched,
      ...stamp,
    } satisfies CachedResolve)
    if (result.searched) await clearWanted(mbid, decade)
    return answer(result.tracks, { searched: result.searched })
  } catch (error) {
    if (error instanceof QuotaError) {
      // Never cached — the overnight job or a later visit finishes it.
      await markWanted(mbid, decade, name)
      return NextResponse.json({ quota: true }, { status: 503 })
    }
    console.error(`queue resolve ${mbid}/${decade} failed:`, error)
    return NextResponse.json({ error: 'Resolve failed' }, { status: 502 })
  }
}
