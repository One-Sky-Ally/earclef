/**
 * Helpers shared by the Discover routes: the legacy-pool sanitizer, the
 * stocked-pick check at upload, and dev fixtures.
 */
import type { DiscoverPick, DiscoverPool } from './types'

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VIDEO_ID = /^[\w-]{11}$/
const SONG_KINDS = new Set(['official-video', 'audio', 'video'])

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function link<K extends string>(value: unknown): { kind: K; url: string } | null {
  if (!value || typeof value !== 'object') return null
  const { kind, url } = value as { kind?: unknown; url?: unknown }
  const safe = httpsUrl(url)
  return typeof kind === 'string' && safe ? { kind: kind as K, url: safe } : null
}

/**
 * A stocked pick as uploaded by the refresh script — checked at the
 * door even though only the owner key can upload: stored output
 * outlives the code that wrote it. Returns null for anything unusable.
 */
export function sanitizeStockPick(
  raw: unknown,
  rosterSlugs: ReadonlySet<string>,
): DiscoverPick | null {
  if (!raw || typeof raw !== 'object') return null
  const pick = raw as Record<string, unknown>
  const name = text(pick.name, 200)
  const mbid = typeof pick.mbid === 'string' && MBID.test(pick.mbid) ? pick.mbid : null
  if (!name || !mbid) return null
  const play = link<NonNullable<DiscoverPick['play']>['kind']>(pick.play)
  const read =
    link<DiscoverPick['read']['kind']>(pick.read) ??
    ({ kind: 'musicbrainz', url: `https://musicbrainz.org/artist/${mbid}` } as const)
  const rawSong = pick.song as Record<string, unknown> | null | undefined
  const song =
    rawSong &&
    typeof rawSong.videoId === 'string' &&
    VIDEO_ID.test(rawSong.videoId) &&
    text(rawSong.title, 300) &&
    SONG_KINDS.has(String(rawSong.kind))
      ? (rawSong as unknown as DiscoverPick['song'])
      : null
  const bandcamp = httpsUrl(pick.bandcamp)
  const connectsTo = Array.isArray(pick.connectsTo)
    ? [...new Set(pick.connectsTo)]
        .filter((slug): slug is string => typeof slug === 'string' && rosterSlugs.has(slug))
        .slice(0, 3)
    : []
  return {
    name,
    why: text(pick.why, 400) ?? '',
    knownFor: text(pick.knownFor, 200) ?? '',
    knownForVerified: pick.knownForVerified === true,
    mbid,
    play,
    read,
    listenHref: play?.url ?? read.url,
    song,
    bandcamp:
      bandcamp && /(^|\.)bandcamp\.com$/.test(new URL(bandcamp).hostname) ? bandcamp : null,
    connectsTo,
  }
}

/**
 * Pools written before the verified-play change carry search-URL
 * listenHrefs and unverified knownFor titles; legacy picks lack `read`.
 * Strip both at the door (read-about links only) — stored output
 * outlives the generator that wrote it.
 */
export function sanitizePool(pool: DiscoverPool): DiscoverPool {
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
        song: null,
        bandcamp: null,
      }
    }),
  }
}

/** Dev-only pool fixture: verify rendering with zero model calls. */
export async function readFixture(path: string | undefined): Promise<DiscoverPool | null> {
  if (!path || process.env.NETLIFY === 'true') return null
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(path, 'utf8')) as DiscoverPool
  } catch (error) {
    console.error('Discover fixture unreadable:', error)
    return null
  }
}
