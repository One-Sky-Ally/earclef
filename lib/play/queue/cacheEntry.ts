/**
 * The queue cache: one Blobs entry per artist × decade. Rules for when a
 * stored answer may be served, and the 30-day refresh YouTube requires.
 *
 * VALIDITY, oldest rulings first:
 *   - pre-rule search tracks (no `corroborated`) are misses (John Mayer,
 *     Aug 9 2026);
 *   - entries written under an older GATE_PASS re-resolve (content gates);
 *   - artists with era-dating corrections re-resolve when the corrections
 *     version moves (Stage 4);
 *   - the read-time title gate drops tracks that fail it today, and an
 *     entry it empties re-resolves (Oct 10 2026);
 *   - "nothing found" is remembered for NULL_TTL_DAYS (180, up from 30 on
 *     Nov 19 2026: a sparse place revisited a month later re-spent the same
 *     failed searches) — unless it was written under older matching
 *     (MATCH_VERSION), which deserves one fresh look;
 *   - a needsSearch marker answers a free-only request as "deferred" and
 *     is a miss for a request that may search.
 *
 * REFRESH (Developer Policies III.E.4, found Nov 19 2026): data fetched
 * with an API key may be stored at most 30 days, then refreshed or
 * deleted. A found entry whose YouTube facts are older than
 * REFRESH_AFTER_DAYS is re-read with videos.list (1 unit per 50 ids, never a
 * search) when it is served, and by the nightly sweep when it is not:
 *   - gone or unplayable videos drop;
 *   - titles take their current value;
 *   - the promo and title gates run again;
 *   - the stamp moves.
 * An entry left with nothing re-resolves.
 *
 * Relative imports only: bundled into Netlify functions.
 */
import { getStore } from '@netlify/blobs'
import { channelMatchesArtist, channelNamesFor } from '../artistMatch'
import { playableSetAll, QuotaError } from '../channelSongs'
import { cachedTrackPasses, describesPromo } from '../contentGates'
import { REFRESH_AFTER_DAYS, saveLearnedChannel } from './learnedChannel'
import type { CachedResolve, QueueTrack } from './types'

/** Content-gate rules version (3 = non-music verdicts). */
export const GATE_PASS = 3
/** Description promo gate version. */
export const PROMO_CHECK = 1
/** Matching rules version: 1 = artistMatch + Discogs leads (Nov 19 2026). */
export const MATCH_VERSION = 1
export const NULL_TTL_DAYS = 180
const NULL_TTL_MS = NULL_TTL_DAYS * 86_400_000
/** A deferred marker is a speed-up only; re-derive it monthly. */
const DEFERRED_TTL_MS = 30 * 86_400_000
const REFRESH_AFTER_MS = REFRESH_AFTER_DAYS * 86_400_000

export function queueStore() {
  return getStore({ name: 'queue', consistency: 'eventual' })
}

export type CacheVerdict =
  | { kind: 'serve'; tracks: QueueTrack[] }
  | { kind: 'deferred' }
  | { kind: 'miss' }

export function tracksOf(entry: CachedResolve | null): QueueTrack[] {
  return entry?.tracks ?? (entry?.track ? [entry.track] : [])
}

/** Is a stored found-entry due its 30-day re-read? */
export function needsRefresh(entry: CachedResolve, now = Date.now()): boolean {
  return (
    (entry.promo ?? 0) < PROMO_CHECK ||
    now - Date.parse(entry.checkedAt ?? entry.at) >= REFRESH_AFTER_MS
  )
}

/**
 * Re-reads a found entry's videos. Returns the refreshed entry (tracks may
 * be empty), or null when the API refused (quota) and nothing changed.
 */
export async function refreshEntry(
  entry: CachedResolve,
  mbid: string,
  name: string,
  apiKey: string,
): Promise<CachedResolve | null> {
  const held = tracksOf(entry)
  let facts: Awaited<ReturnType<typeof playableSetAll>>
  try {
    facts = await playableSetAll(held.map((track) => track.videoId), apiKey)
  } catch (error) {
    if (error instanceof QuotaError) return null
    throw error
  }
  const kept = held
    .filter((track) => facts.playable.has(track.videoId))
    .filter((track) => !describesPromo(facts.meta.get(track.videoId)?.description))
    .map((track) => ({ ...track, title: facts.meta.get(track.videoId)?.title ?? track.title }))
    // Entries written before Nov 19 2026 do not store the artist's name;
    // the sweep refreshes those without the name-dependent gates, which
    // the read path then applies with the name in hand.
    .filter((track) => !name || cachedTrackPasses(track, name))
  // An older search find came from a channel named exactly for the artist:
  // teach that channel, so the artist's other decades need no search.
  const searchFind = kept.find((track) => track.source === 'search')
  const channel = searchFind ? facts.meta.get(searchFind.videoId) : undefined
  if (name && channel?.channelId && channel.channelTitle && channelMatchesArtist(channel.channelTitle, channelNamesFor(name, []))) {
    await saveLearnedChannel(mbid, { channelId: channel.channelId, channelTitle: channel.channelTitle, via: 'search' })
  }
  return {
    ...entry,
    track: kept[0] ?? null,
    tracks: kept,
    promo: PROMO_CHECK,
    checkedAt: new Date().toISOString(),
  }
}

interface ReadOptions {
  key: string
  mbid: string
  name: string
  allowSearch: boolean
  redatedVersion: string | null
  apiKey: string | undefined
}

/** What the cache can answer for this request, refreshing as it goes. */
export async function readCached(options: ReadOptions): Promise<CacheVerdict> {
  const { key, mbid, name, allowSearch, redatedVersion, apiKey } = options
  let entry: CachedResolve | null = null
  try {
    entry = (await queueStore().get(key, { type: 'json' })) as CachedResolve | null
  } catch {
    return { kind: 'miss' }
  }
  if (!entry) return { kind: 'miss' }
  const poisoned = entry.track?.source === 'search' && !entry.track.corroborated
  const ungated = (entry.pass ?? 0) < GATE_PASS
  const redated = redatedVersion !== null && entry.cv !== redatedVersion
  if (poisoned || ungated || redated) return { kind: 'miss' }

  const held = tracksOf(entry)
  if (held.length === 0) {
    const age = Date.now() - Date.parse(entry.at)
    const current = (entry.mv ?? 0) >= MATCH_VERSION
    if (entry.needsSearch) {
      return !allowSearch && current && age < DEFERRED_TTL_MS ? { kind: 'deferred' } : { kind: 'miss' }
    }
    return current && age < NULL_TTL_MS ? { kind: 'serve', tracks: [] } : { kind: 'miss' }
  }

  const passing = held.filter((track) => cachedTrackPasses(track, name))
  if (passing.length === 0) return { kind: 'miss' }
  if (!apiKey || !needsRefresh(entry)) return { kind: 'serve', tracks: passing }
  let fresh: CachedResolve | null = null
  try {
    fresh = await refreshEntry({ ...entry, tracks: passing, track: passing[0] }, mbid, name, apiKey)
  } catch {
    return { kind: 'serve', tracks: passing }
  }
  // Quota trouble: serve what we have; the next read tries again.
  if (!fresh) return { kind: 'serve', tracks: passing }
  await storeRefreshed(key, fresh)
  const kept = tracksOf(fresh)
  return kept.length > 0 ? { kind: 'serve', tracks: kept } : { kind: 'miss' }
}

/**
 * Writes a refreshed entry. One its refresh emptied is deleted rather than
 * stored: an empty entry reads as "nothing found" for 180 days, but these
 * videos died; the artist deserves a fresh resolve.
 */
export async function storeRefreshed(key: string, fresh: CachedResolve): Promise<void> {
  try {
    if (tracksOf(fresh).length === 0) await queueStore().delete(key)
    else await queueStore().setJSON(key, fresh)
  } catch {
    // Best-effort; the next read or sweep tries again.
  }
}

export async function writeEntry(key: string, entry: CachedResolve): Promise<void> {
  try {
    await queueStore().setJSON(key, entry)
  } catch {
    // Cache writes are best-effort.
  }
}
