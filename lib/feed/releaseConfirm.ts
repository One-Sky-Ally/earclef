/**
 * The feed's recent and upcoming releases, each either confirmed real by
 * that artist, with links that open it, or left out (owner, Nov 23 2026:
 * Björk's "Ambient Playlist", "The Björk Sides" and "Orkestral Live" were
 * fan bootlegs MusicBrainz lists, and a search for one on Amazon Music
 * showed Moby and Michael Jackson).
 *
 * A release stays when it is in the artist's own Apple Music catalogue,
 * in their own Deezer catalogue, or when MusicBrainz shows an OFFICIAL
 * release of it living somewhere real (a service, a store, Discogs). It
 * is left out only when every source ANSWERED and none confirms it: a
 * source that did not answer is never a verdict.
 *
 * RELATIVE imports only: bundled into the feed's background function.
 */
import { getStore } from '@netlify/blobs'
import {
  checkFromReleases,
  matchesByTitle,
  type MbReleaseWithLinks,
  type ReleaseCheck,
  type ReleaseLinks,
} from '../listen/releaseLinks'
import { RECENT_DAYS } from './releaseLists'

export type Fetcher = (url: string) => Promise<Response | null>

const DAY_MS = 86_400_000

// --- Dates, which may be YYYY, YYYY-MM or YYYY-MM-DD. ---

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/

function precision(date: string): 'day' | 'month' | 'year' | null {
  if (FULL_DATE.test(date.slice(0, 10))) return 'day'
  if (/^\d{4}-\d{2}$/.test(date)) return 'month'
  if (/^\d{4}$/.test(date)) return 'year'
  return null
}

/** A date's first day: "2026" is Jan 1, "2026-07" is Jul 1. */
function firstDay(date: string): number {
  const day = date.slice(0, 10)
  return Date.parse(day.length === 4 ? `${day}-01-01` : day.length === 7 ? `${day}-01` : day)
}

/** Days between two dates, each read from its first day. */
function daysApart(a: string, b: string): number {
  return Math.abs(firstDay(a) - firstDay(b)) / DAY_MS
}

/**
 * Close enough to be the same release: within 45 days when both dates
 * are full, the same or next month when one is a month, the same or
 * next year when one is only a year.
 */
export function sameTime(a: string, b: string): boolean {
  const pa = precision(a)
  const pb = precision(b)
  if (!pa || !pb) return false
  if (pa === 'year' || pb === 'year') return Math.abs(Number(a.slice(0, 4)) - Number(b.slice(0, 4))) <= 1
  if (pa === 'month' || pb === 'month') return daysApart(a.slice(0, 7), b.slice(0, 7)) <= 31
  return daysApart(a, b) <= 45
}

// --- Deezer. ---

export interface DeezerAlbum {
  title: string
  /** YYYY-MM-DD, as Deezer gives it. */
  date: string
  link: string
  /** Deezer's record_type: album, ep, single or compile. */
  type?: string
}

/** What a release is: an album, or a single/EP (the two are often filed either way). */
export type ReleaseKind = 'Album' | 'Single' | 'EP'

function kindFamily(kind: string | undefined): 'album' | 'single' | null {
  switch (kind?.toLowerCase()) {
    case 'album':
    case 'compile':
      return 'album'
    case 'single':
    case 'ep':
      return 'single'
    default:
      return null
  }
}

/**
 * The same kind of release: an album is never its title-track single.
 * When either side's kind is unknown, only a full date within a week
 * will do.
 */
function sameKind(kind: ReleaseKind | undefined, other: string | undefined, date: string, otherDate: string): boolean {
  const a = kindFamily(kind)
  const b = kindFamily(other)
  if (a && b) return a === b
  return precision(date) === 'day' && precision(otherDate) === 'day' && daysApart(date, otherDate) <= 7
}

export interface DeezerCatalogue {
  albums: DeezerAlbum[]
  /** Every page asked for answered (no ids to ask about counts as answered). */
  answered: boolean
}

const DEEZER_ALBUM = /^https:\/\/www\.deezer\.com\/album\/\d+$/
const DEEZER_PAGES = 5

/** The albums, EPs and singles on these Deezer artist pages. */
export async function deezerAlbums(
  artistIds: readonly string[],
  fetcher: Fetcher,
): Promise<DeezerCatalogue> {
  const albums: DeezerAlbum[] = []
  let answered = true
  for (const id of artistIds) {
    let url: string | null = `https://api.deezer.com/artist/${id}/albums?limit=100`
    for (let page = 0; url && page < DEEZER_PAGES; page++) {
      const res = await fetcher(url)
      const body = res?.ok
        ? ((await res.json().catch(() => null)) as {
            data?: Array<{ title?: string; release_date?: string; link?: string; record_type?: string }>
            next?: string
          } | null)
        : null
      // Deezer answers errors (quota, outages) with a 200 and an error body.
      if (!body || !Array.isArray(body.data)) {
        answered = false
        break
      }
      albums.push(
        ...body.data.flatMap((album) =>
          album.title && album.link && DEEZER_ALBUM.test(album.link)
            ? [{ title: album.title, date: album.release_date ?? '', link: album.link, type: album.record_type }]
            : [],
        ),
      )
      url = typeof body.next === 'string' && body.next.startsWith('https://api.deezer.com/') ? body.next : null
    }
  }
  return { albums, answered }
}

/**
 * The Deezer album with this release's title from the same time, the
 * closest in date when several share it: Björk's "Fossora" album
 * (Sep 30) is not her "Fossora" single (Sep 27), and an artist's 2026
 * single "Sing" is not their 2012 album "Sing".
 */
export function deezerMatch(
  title: string,
  date: string,
  albums: readonly DeezerAlbum[],
  kind?: ReleaseKind,
): DeezerAlbum | undefined {
  return matchesByTitle(title, albums, (album) => album.title)
    .filter((album) => sameTime(album.date, date) && sameKind(kind, album.type, date, album.date))
    .sort((a, b) => daysApart(a.date, date) - daysApart(b.date, date))[0]
}

// --- MusicBrainz release groups. ---

export interface GroupRef {
  id: string
  date: string
  /** MusicBrainz primary type: Album, Single, EP, … */
  type?: string
}

/**
 * The MusicBrainz group an Apple Music release is: same title (the
 * caller's key), same time, same kind, then the closest date. A
 * title-track single and its album share a title, never a group.
 */
export function closestGroup(
  date: string,
  kind: ReleaseKind,
  groups: readonly GroupRef[],
): string | undefined {
  return groups
    .filter(
      (group) =>
        // A group dated by year alone is too loose to lend its links.
        precision(group.date) !== 'year' &&
        sameTime(group.date, date) &&
        sameKind(kind, group.type, date, group.date),
    )
    .sort((a, b) => daysApart(a.date, date) - daysApart(b.date, date))[0]?.id
}

export interface StoredCheck extends ReleaseCheck {
  at: string
}

export type CheckCache = Readonly<Record<string, StoredCheck>>

const CHECKS_KEY = 'release-checks/v1'
/** Links get added to new releases for a while: read them again after this long. */
export const CHECK_TTL_MS = 3 * DAY_MS
/** Entries nobody refreshed in this long are dropped when the cache is written. */
const CHECK_KEEP_MS = 30 * DAY_MS
/** Release groups read per artist per night; the rest wait for the next night. */
export const MAX_CHECKS_PER_ARTIST = 12

let devChecks: CheckCache = {}

function store() {
  return getStore({ name: 'feed', consistency: 'strong' })
}

/**
 * The cache, and whether it was really read. After a failed read the
 * cache must not be written back: it would replace everything with one
 * batch's worth.
 */
export async function readChecks(): Promise<{ cache: CheckCache; read: boolean }> {
  try {
    return { cache: ((await store().get(CHECKS_KEY, { type: 'json' })) ?? {}) as CheckCache, read: true }
  } catch {
    return { cache: devChecks, read: false }
  }
}

export async function writeChecks(cache: CheckCache, now: number = Date.now()): Promise<void> {
  const kept = Object.fromEntries(
    Object.entries(cache).filter(([, check]) => now - Date.parse(check.at) < CHECK_KEEP_MS),
  )
  try {
    await store().setJSON(CHECKS_KEY, kept)
  } catch {
    devChecks = kept
  }
}

/**
 * Reads the release groups whose check is missing or stale, at most
 * `max` of them. A read that fails keeps whatever was there before:
 * MusicBrainz being busy is never a verdict.
 */
export async function refreshChecks(
  releaseGroupIds: readonly string[],
  cache: CheckCache,
  fetcher: Fetcher,
  pause: () => Promise<void>,
  now: number = Date.now(),
  max: number = MAX_CHECKS_PER_ARTIST,
): Promise<CheckCache> {
  const due = [...new Set(releaseGroupIds)]
    .filter((id) => !cache[id] || now - Date.parse(cache[id].at) >= CHECK_TTL_MS)
    .slice(0, max)
  const fresh: Record<string, StoredCheck> = {}
  for (const id of due) {
    const res = await fetcher(
      `https://musicbrainz.org/ws/2/release?release-group=${id}&inc=url-rels&fmt=json&limit=100`,
    )
    await pause()
    if (!res?.ok) continue
    const body = (await res.json().catch(() => null)) as { releases?: MbReleaseWithLinks[] } | null
    if (!body || !Array.isArray(body.releases)) continue
    fresh[id] = { ...checkFromReleases(body.releases), at: new Date(now).toISOString() }
  }
  return Object.keys(fresh).length > 0 ? { ...cache, ...fresh } : cache
}

// --- The decision, pure. ---

/** Releases out in the past year, and the announced ones: the two pop-ups' rows. */
export function inReleaseWindow(date: string, todayIso: string): boolean {
  const cutoff = new Date(Date.parse(todayIso) - (RECENT_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10)
  return date.slice(0, 10) >= cutoff
}

export interface ReleaseCandidate {
  title: string
  date: string
  href: string
  links?: ReleaseLinks
}

export interface Sources {
  deezer: DeezerCatalogue
  /** Whether the artist's Apple Music catalogue answered. */
  appleAnswered: boolean
  /** Album ids in the artist's own Apple Music catalogue (the US store the links open). */
  appleIds?: ReadonlySet<string>
  /** YYYY-MM-DD: a MusicBrainz date over a year past it is taken for a typo. */
  today?: string
}

/** Announcements reach months ahead, not years: past this, a date is a typo. */
const FURTHEST_ANNOUNCEMENT_DAYS = 400

/**
 * An Apple Music link from MusicBrainz counts only when that album is in
 * the artist's own Apple Music catalogue: MusicBrainz can link a store
 * edition the US store does not carry (Nov 23 2026: Björk's Orkestral
 * album, linked to its Iceland-only edition).
 */
function listedOnApple(links: ReleaseLinks, appleIds: ReadonlySet<string> | undefined): ReleaseLinks {
  const id = links.appleMusic?.match(/\/album\/(?:[^/]+\/)?(\d+)$/)?.[1]
  if (!links.appleMusic || (id && appleIds?.has(id))) return links
  return Object.fromEntries(
    Object.entries(links).filter(([service]) => service !== 'appleMusic'),
  ) as ReleaseLinks
}

/**
 * The release as the feed should show it, or null. `links.appleMusic`
 * already set means it came from the artist's Apple Music catalogue;
 * `check` is undefined when MusicBrainz never answered for its group.
 * Left out when MusicBrainz says no release of it is official, or when
 * every source answered and none confirms it — and, since it cannot be
 * placed among dated releases, when it has nothing better than a year.
 */
export function confirmRelease<T extends ReleaseCandidate>(
  item: T,
  check: ReleaseCheck | undefined,
  sources: Sources,
  kind?: ReleaseKind,
): T | null {
  const onApple = Boolean(item.links?.appleMusic)
  // Jordan Rakei's "Paradise" sits on MusicBrainz as 30 Sep 2029; Deezer
  // has it out on 30 Sep 2026. A date that far ahead says nothing, so the
  // title and kind alone find it.
  const typo =
    !onApple &&
    sources.today !== undefined &&
    precision(item.date) !== null &&
    firstDay(item.date) - Date.parse(sources.today) > FURTHEST_ANNOUNCEMENT_DAYS * DAY_MS
  const onDeezer = typo
    ? matchesByTitle(item.title, sources.deezer.albums, (album) => album.title).find(
        (album) => kind !== undefined && kindFamily(kind) === kindFamily(album.type),
      )
    : deezerMatch(item.title, item.date, sources.deezer.albums, kind)
  const official = check?.official ? check : undefined
  const onMusicBrainz = Boolean(
    official && (official.documented || Object.keys(official.links).length > 0),
  )
  if (!onApple && !onDeezer) {
    if (check && !check.official) return null
    const everyoneAnswered = check !== undefined && sources.appleAnswered && sources.deezer.answered
    if (!onMusicBrainz && everyoneAnswered) return null
  }

  const links: ReleaseLinks = {
    ...(official ? listedOnApple(official.links, sources.appleIds) : {}),
    ...(onDeezer ? { deezer: onDeezer.link } : {}),
    ...item.links,
  }
  // Apple's date is the release day already; a MusicBrainz year or month
  // takes a service's full date, else the release's own.
  const serviceDate = onDeezer && FULL_DATE.test(onDeezer.date) ? onDeezer.date : undefined
  const date =
    onApple || (precision(item.date) === 'day' && !typo)
      ? item.date
      : (serviceDate ?? official?.date ?? item.date)
  if (precision(date) === 'year' || precision(date) === null) {
    // MusicBrainz never answered for it: its year stays as it was until
    // the release's own date can be read — not answering is no verdict.
    return check === undefined && !onDeezer ? item : null
  }
  return { ...item, date, links, href: links.appleMusic ?? item.href }
}
