/**
 * The precomputed feed: one nightly pass over the whole roster (MusicBrainz
 * backbone + iTunes freshness overlay + YouTube RSS videos) stored in the
 * Blobs "feed" store, so a /feed visit is ONE fetch instead of ~100.
 *
 * RELATIVE imports only — this file is bundled into a Netlify background
 * function, which cannot resolve the @/ alias.
 */
import { getStore } from '@netlify/blobs'
import {
  coverArtUrl,
  coverArtUrlLarge,
  youtubeThumbnailUrl,
  youtubeThumbnailLargeUrl,
  youtubeWatchUrl,
} from '../links'
import { musicServiceSearchUrl } from '../listen/services'
import { appleCollectionUrl, type ReleaseLinks } from '../listen/releaseLinks'
import { normalizedTitle } from './blurbKey'
import { isSubstantiveVideo } from './substance'
import { dropShortClips, settledLengths } from './clipLength'
import { READ_TIMEOUT_MS, learnLengths } from './videoLengths'
import roster from '../discover/roster.json'
import { builtToday } from './rebuild'
import { batchFetcher, fetchWithRetry as patientFetch } from './patientFetch'
import { buildIsDone, carriedReleases, inRetryPass, noteForRetry, replaceArtistReleases } from './retryPass'
export { carriedReleases } from './retryPass'
import {
  closestGroup,
  confirmRelease,
  deezerAlbums,
  inReleaseWindow,
  readChecks,
  refreshChecks,
  writeChecks,
  type CheckCache,
  type GroupRef,
  type ReleaseKind,
} from './releaseConfirm'

export {
  BACKGROUND_FUNCTION_PATH,
  triggerRebuild,
  type TriggerOptions,
  type TriggerResult,
} from './rebuild'

export interface SnapshotItem {
  type: 'release' | 'video'
  slug: string
  artistName: string
  title: string
  date: string
  image: string
  imageLarge?: string
  href: string
  /** Videos only — for playability rechecks on rebuilds. */
  videoId?: string
  /** Contextless videos get demoted client-side; absent = substantive. */
  substance?: 'filler'
  /** Videos only — how long it runs; absent when the lookup failed. */
  seconds?: number
  /**
   * Releases only — the release itself on each service it was confirmed
   * on (lib/listen/releaseLinks). Missing services keep a labelled search.
   */
  links?: ReleaseLinks
}

/**
 * A release while the batch is built: its MusicBrainz group (id and
 * primary type) when it has one, and an Apple release's kind.
 */
type BuiltRelease = SnapshotItem & {
  rgId?: string
  rgType?: string
  kind?: ReleaseKind
}

/** A MusicBrainz primary type as a release kind; Broadcast, Other … are unknown. */
function kindOf(type: string | undefined): ReleaseKind | undefined {
  return type === 'Album' || type === 'Single' || type === 'EP' ? type : undefined
}

/** Build state stays behind: only feed fields reach the snapshot. */
const BUILD_STATE = new Set(['rgId', 'rgType', 'kind'])

function feedItem(built: BuiltRelease): SnapshotItem {
  return Object.fromEntries(
    Object.entries(built).filter(([key]) => !BUILD_STATE.has(key)),
  ) as unknown as SnapshotItem
}

export interface FeedSnapshot {
  builtAt: string
  /** Roster size this snapshot covers — used to detect a grown roster. */
  rosterLength: number
  items: SnapshotItem[]
  /** Artists whose MusicBrainz or Apple lookup never fully answered, second try included. */
  releasesUnanswered?: string[]
}

/** Resumable build state: which roster slice has been fetched so far. */
export interface BuildProgress {
  date: string
  cursor: number
  rosterLength: number
  items: SnapshotItem[]
  /** Artists whose MusicBrainz or Apple lookup did not answer: asked again at the end (./retryPass). */
  retry?: string[]
  /** Asked again and still no full answer: their kept rows stay. */
  unanswered?: string[]
}

const SNAPSHOT_KEY = 'snapshot/v1'
const PROGRESS_KEY = 'build-progress/v1'
const USER_AGENT =
  'EarClefFeed/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const VIDEOS_PER_ARTIST = 8
const MAX_ITEMS = 600
/**
 * Artists fetched per invocation. Sized so a batch (with MusicBrainz/
 * iTunes/YouTube retries) comfortably finishes well inside Netlify's
 * 15-minute background-function budget, so the whole roster completes
 * across several self-chained invocations instead of stalling partway.
 */
export const BATCH_SIZE = 15
/**
 * No new artist starts after this long in a batch: with the release
 * checks a slow MusicBrainz night could otherwise run a batch past
 * Netlify's 15 minutes and lose all of it. Nine, not ten, since the
 * patient MusicBrainz retries (./patientFetch) can hold one artist
 * about three minutes on a night it never answers.
 */
const BATCH_DEADLINE_MS = 9 * 60 * 1000

let devSnapshot: FeedSnapshot | null = null
let devProgress: BuildProgress | null = null

function store() {
  return getStore({ name: 'feed', consistency: 'strong' })
}

export async function readSnapshot(): Promise<FeedSnapshot | null> {
  try {
    return ((await store().get(SNAPSHOT_KEY, { type: 'json' })) ??
      null) as FeedSnapshot | null
  } catch {
    return devSnapshot
  }
}

export async function writeSnapshot(snapshot: FeedSnapshot): Promise<void> {
  try {
    await store().setJSON(SNAPSHOT_KEY, snapshot)
  } catch {
    devSnapshot = snapshot
  }
}

export async function readProgress(): Promise<BuildProgress | null> {
  try {
    return ((await store().get(PROGRESS_KEY, { type: 'json' })) ??
      null) as BuildProgress | null
  } catch {
    return devProgress
  }
}

export async function writeProgress(progress: BuildProgress): Promise<void> {
  try {
    await store().setJSON(PROGRESS_KEY, progress)
  } catch {
    devProgress = progress
  }
}

export async function clearProgress(): Promise<void> {
  try {
    await store().delete(PROGRESS_KEY)
  } catch {
    devProgress = null
  }
}

export interface BuildLock {
  date: string
  updatedAt: number
}

const LOCK_KEY = 'build-lock/v1'
let devLock: BuildLock | null = null

export async function readLock(): Promise<BuildLock | null> {
  try {
    return ((await store().get(LOCK_KEY, { type: 'json' })) ??
      null) as BuildLock | null
  } catch {
    return devLock
  }
}

export async function writeLock(lock: BuildLock): Promise<void> {
  try {
    await store().setJSON(LOCK_KEY, lock)
  } catch {
    devLock = lock
  }
}

export async function clearLock(): Promise<void> {
  try {
    await store().delete(LOCK_KEY)
  } catch {
    devLock = null
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const FETCH_TIMEOUT_MS = 20_000

/** MusicBrainz gets five patient tries (./patientFetch); others three quick ones. */
function fetchWithRetry(url: string): Promise<Response | null> {
  return patientFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, userAgent: USER_AGENT })
}

type Fetcher = (url: string) => Promise<Response | null>

/** No request starts after this long in a batch: Netlify stops it at 15 minutes. */
const HARD_STOP_MS = 13 * 60 * 1000
/** Retry waiting a whole batch may spend on busy upstreams (./patientFetch). */
const RETRY_BUDGET_MS = 4 * 60 * 1000

/** The batch's one fetcher: patient, inside the hard stop and the retry budget. */
function fetcherFor(started: number, heartbeat?: () => Promise<void>): Fetcher {
  return batchFetcher({
    hardStop: started + HARD_STOP_MS,
    retryBudgetMs: RETRY_BUDGET_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: USER_AGENT,
    heartbeat,
  })
}

export interface RosterEntry {
  slug: string
  name: string
  mbid: string | null
  channelId: string | null
  itunesId: string | null
  /** Deezer artist pages MusicBrainz links to the artist. */
  deezerIds?: string[]
}

/** Current roster size — a snapshot covering fewer artists is stale. */
export const ROSTER_LENGTH = (roster as RosterEntry[]).length

/** Not music releases by the artist: an interview, a podcast, an audiobook. */
const NOT_RELEASES = new Set(['Interview', 'Audiobook', 'Audio drama'])

/** The artist's MusicBrainz release groups; `answered` is false when a page never came. */
async function mbReleases(
  entry: RosterEntry,
  fetcher: Fetcher,
): Promise<{ items: BuiltRelease[]; answered: boolean }> {
  if (!entry.mbid) return { items: [], answered: true }
  const items: BuiltRelease[] = []
  let answered = true
  interface MbRg {
    id: string
    title: string
    'first-release-date'?: string
    'primary-type'?: string
    'secondary-types'?: string[]
  }
  for (let offset = 0; offset < 300; offset += 100) {
    // website-default: groups with an OFFICIAL release only — bootlegs,
    // promos and withdrawn releases stay out (owner, Nov 23 2026).
    const res = await fetcher(
      `https://musicbrainz.org/ws/2/release-group?artist=${entry.mbid}&release-group-status=website-default&limit=100&offset=${offset}&fmt=json`,
    )
    if (!res?.ok) {
      answered = false
      break
    }
    // The fetch timeout also covers the body: a slow one is no answer.
    const body = (await res.json().catch(() => null)) as {
      'release-group-count'?: number
      'release-groups'?: MbRg[]
    } | null
    // A busy MusicBrainz can answer 200 with an error body.
    if (!body || !Array.isArray(body['release-groups'])) {
      answered = false
      break
    }
    for (const rg of body['release-groups']) {
      const date = rg['first-release-date']
      if (!date) continue
      if ((rg['secondary-types'] ?? []).some((type) => NOT_RELEASES.has(type))) continue
      items.push({
        rgId: rg.id,
        rgType: rg['primary-type'],
        type: 'release',
        slug: entry.slug,
        artistName: entry.name,
        title: rg.title,
        date,
        image: coverArtUrl(rg.id),
        imageLarge: coverArtUrlLarge(rg.id),
        // Stored default; FeedPostCard re-resolves per the fan's service.
        href: musicServiceSearchUrl('appleMusic', entry.name, rg.title),
      })
    }
    if (offset + 100 >= (body['release-group-count'] ?? 0)) break
    await sleep(1100)
  }
  return { items, answered }
}

interface ItunesCollection {
  wrapperType?: string
  collectionName?: string
  collectionViewUrl?: string
  releaseDate?: string
  artworkUrl100?: string
}

/** The artist's Apple Music collections; null when Apple did not answer. */
async function itunesCollections(entry: RosterEntry, fetcher: Fetcher): Promise<ItunesCollection[] | null> {
  // Apple sometimes answers an artist with no collections at all, and the
  // whole catalogue a moment later (Nov 23 2026: John Coltrane): one more try.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetcher(
      `https://itunes.apple.com/lookup?id=${entry.itunesId}&entity=album&limit=200&sort=recent`,
    )
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as { results?: ItunesCollection[] } | null)
      : null
    const collections = (body?.results ?? []).filter((result) => result.wrapperType === 'collection')
    if (collections.length > 0) return collections
    if (attempt === 1) await sleep(3000)
  }
  return null
}

async function itunesReleases(
  entry: RosterEntry,
  fetcher: Fetcher,
): Promise<{ items: BuiltRelease[]; answered: boolean; ids: ReadonlySet<string> }> {
  if (!entry.itunesId) return { items: [], answered: true, ids: new Set() }
  const collections = await itunesCollections(entry, fetcher)
  if (!collections) return { items: [], answered: false, ids: new Set() }
  const ids = new Set(
    collections.flatMap((result) => {
      const id = appleCollectionUrl(result.collectionViewUrl)?.match(/\/(\d+)$/)?.[1]
      return id ? [id] : []
    }),
  )
  const items = collections
    .filter((result) => result.collectionName && result.releaseDate)
    .map((result): BuiltRelease => {
      // The collection itself, from the artist's own catalogue.
      const apple = appleCollectionUrl(result.collectionViewUrl)
      const kind = / - Single$/i.test(result.collectionName!)
        ? 'Single'
        : / - EP$/i.test(result.collectionName!)
          ? 'EP'
          : 'Album'
      return {
        type: 'release' as const,
        slug: entry.slug,
        artistName: entry.name,
        title: result.collectionName!.replace(/ - (Single|EP)$/i, ''),
        date: result.releaseDate!.slice(0, 10),
        image: result.artworkUrl100 ?? '/images/hero-placeholder.svg',
        imageLarge: result.artworkUrl100?.replace('100x100', '600x600'),
        href:
          apple ??
          musicServiceSearchUrl('appleMusic', entry.name, result.collectionName!),
        ...(apple ? { links: { appleMusic: apple } } : {}),
        kind,
      }
    })
  return { items, answered: true, ids }
}

function unescapeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function rssVideos(entry: RosterEntry, fetcher: Fetcher = fetchWithRetry): Promise<SnapshotItem[]> {
  if (!entry.channelId) return []
  const res = await fetcher(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${entry.channelId}`,
  )
  if (!res?.ok) return []
  const xml = await res.text().catch(() => null)
  if (xml === null) return []
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  return entries
    .flatMap((match) => {
      const block = match[1]
      const videoId = block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1]
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
      const published = block.match(/<published>([\d-]{10})/)?.[1]
      if (!videoId || !title || !published) return []
      // The RSS ships the description too — the substance check is free.
      const description =
        block.match(
          /<media:description>([\s\S]*?)<\/media:description>/,
        )?.[1] ?? ''
      const substantive = isSubstantiveVideo(
        unescapeXml(title),
        unescapeXml(description),
      )
      return [
        {
          type: 'video' as const,
          slug: entry.slug,
          artistName: entry.name,
          title: unescapeXml(title),
          date: published,
          image: youtubeThumbnailUrl(videoId),
          imageLarge: youtubeThumbnailLargeUrl(videoId),
          href: youtubeWatchUrl(videoId),
          videoId,
          ...(substantive ? {} : { substance: 'filler' as const }),
        },
      ]
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, VIDEOS_PER_ARTIST)
}

// --- Playability pruning: dead/blocked videos never enter the feed. ---

interface VideoVerdicts {
  [videoId: string]: { ok: boolean; at: string }
}

const VERDICTS_KEY = 'video-checks/v1'
/** Re-verify a video's playability after this long. */
const VERDICT_TTL_MS = 7 * 24 * 60 * 60 * 1000

let devVerdicts: VideoVerdicts = {}

export async function readVerdicts(): Promise<VideoVerdicts> {
  try {
    return ((await store().get(VERDICTS_KEY, { type: 'json' })) ??
      {}) as VideoVerdicts
  } catch {
    return devVerdicts
  }
}

export async function writeVerdicts(verdicts: VideoVerdicts): Promise<void> {
  try {
    await store().setJSON(VERDICTS_KEY, verdicts)
  } catch {
    devVerdicts = verdicts
  }
}

/**
 * oEmbed playability check: 200 = watchable, 4xx = deleted, private,
 * or blocked (the SME-blocked Pink Floyd short fails here). Network
 * flakes keep the video and skip the cache — pruning must never ride
 * on a timeout.
 */
async function checkVideoPlayable(videoId: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { headers: { 'User-Agent': USER_AGENT } },
    )
    if (res.ok) return true
    if (res.status >= 400 && res.status < 500) return false
    return null
  } catch {
    return null
  }
}

/**
 * Drops unplayable videos from a batch's items, consulting and
 * refreshing the shared verdict cache (so rebuilds only re-check new
 * or stale ids, not the whole roster every night).
 */
export async function pruneDeadVideos(
  items: SnapshotItem[],
  verdicts: VideoVerdicts,
): Promise<SnapshotItem[]> {
  const now = Date.now()
  const kept: SnapshotItem[] = []
  for (const item of items) {
    if (item.type !== 'video' || !item.videoId) {
      kept.push(item)
      continue
    }
    const cached = verdicts[item.videoId]
    if (cached && now - Date.parse(cached.at) < VERDICT_TTL_MS) {
      if (cached.ok) kept.push(item)
      continue
    }
    const playable = await checkVideoPlayable(item.videoId)
    if (playable === null) {
      // Unknown — keep the video, decide on a future pass.
      kept.push(item)
      continue
    }
    verdicts[item.videoId] = { ok: playable, at: new Date().toISOString() }
    if (playable) kept.push(item)
    await sleep(120)
  }
  return kept
}

// --- Length rule: nothing under a minute (owner, Nov 18 2026). ---

function videoIds(items: SnapshotItem[]): string[] {
  return items.flatMap((item) =>
    item.type === 'video' && item.videoId && item.seconds === undefined
      ? [item.videoId]
      : [],
  )
}

/**
 * Stamps each video with how long it runs (one videos.list call per 50
 * new ids; remembered after that) and drops the ones under a minute
 * BEFORE the 600-item cap, so longer entries fill the room they leave.
 * Live and upcoming broadcasts stay unstamped for the read path.
 */
async function keepMinuteLong(items: SnapshotItem[]): Promise<SnapshotItem[]> {
  const lengths = settledLengths(await learnLengths(videoIds(items)))
  const stamped = items.map((item) =>
    item.videoId && lengths[item.videoId] !== undefined
      ? { ...item, seconds: lengths[item.videoId] }
      : item,
  )
  return dropShortClips(stamped, {})
}

/**
 * The served snapshot, short clips removed. Snapshots stored before the
 * rule (or nights the lookup failed) carry videos with no `seconds`;
 * those are looked up here once and judged, so clips already in the
 * feed leave it without waiting for the next rebuild.
 */
export async function withoutShortClips(
  snapshot: FeedSnapshot,
): Promise<FeedSnapshot> {
  const unknown = videoIds(snapshot.items)
  // A visitor is waiting: a short limit, and whatever is still unknown
  // is kept and judged on a later read.
  const lengths =
    unknown.length > 0 ? await learnLengths(unknown, READ_TIMEOUT_MS) : {}
  return { ...snapshot, items: dropShortClips(snapshot.items, lengths) }
}

/**
 * iTunes overlay wins duplicate titles (release-day dates on new drops).
 * An Apple release keeps the MusicBrainz group it IS — same title, same
 * time, same kind first — so that group's links count; a title-track
 * single never lends its links to the album (Björk's "Fossora").
 */
function mergeReleases(
  overlay: BuiltRelease[],
  musicbrainz: BuiltRelease[],
): BuiltRelease[] {
  const groups = musicbrainz.reduce((byTitle, item) => {
    const key = normalizedTitle(item.title)
    if (!key || !item.rgId) return byTitle
    const ref: GroupRef = { id: item.rgId, date: item.date, type: item.rgType }
    return byTitle.set(key, [...(byTitle.get(key) ?? []), ref])
  }, new Map<string, GroupRef[]>())
  const seen = new Map<string, BuiltRelease>()
  for (const item of [...overlay, ...musicbrainz]) {
    const key = normalizedTitle(item.title)
    if (seen.has(key)) continue
    const rgId =
      item.rgId ??
      (key && item.kind ? closestGroup(item.date, item.kind, groups.get(key) ?? []) : undefined)
    seen.set(key, rgId ? { ...item, rgId } : item)
  }
  return [...seen.values()]
}

/**
 * One artist's releases for the snapshot: MusicBrainz and iTunes merged,
 * the past year's and the announced ones confirmed or left out. Exported
 * for the local hand-check (the nightly build is the only other caller).
 */
export async function artistReleases(
  entry: RosterEntry,
  checks: CheckCache,
  todayIso: string,
  fetcher: Fetcher = fetchWithRetry,
): Promise<{ items: SnapshotItem[]; checks: CheckCache; complete: boolean }> {
  const musicbrainz = await mbReleases(entry, fetcher)
  const overlay = await itunesReleases(entry, fetcher)
  const confirmed = await confirmedReleases(
    entry,
    mergeReleases(overlay.items, musicbrainz.items),
    checks,
    todayIso,
    { appleAnswered: overlay.answered, appleIds: overlay.ids, today: todayIso },
    // An artist MusicBrainz did not fully answer for goes to the second
    // try anyway: its release checks wait for it (review, Nov 24 2026).
    { fetcher, check: musicbrainz.answered },
  )
  return { ...confirmed, complete: musicbrainz.answered && overlay.answered }
}

/**
 * The past year's and the announced releases, confirmed or left out
 * (lib/feed/releaseConfirm); older ones pass through as they are. The
 * MusicBrainz group id stays behind — it is build state, not feed data.
 */
async function confirmedReleases(
  entry: RosterEntry,
  releases: BuiltRelease[],
  checks: CheckCache,
  todayIso: string,
  apple: { appleAnswered: boolean; appleIds: ReadonlySet<string>; today: string },
  lookup: { fetcher: Fetcher; check: boolean },
): Promise<{ items: SnapshotItem[]; checks: CheckCache }> {
  const windowed = releases.filter((item) => inReleaseWindow(item.date, todayIso))
  const nextChecks = lookup.check
    ? await refreshChecks(
        windowed.flatMap((item) => (item.rgId ? [item.rgId] : [])),
        checks,
        lookup.fetcher,
        async () => {
          await sleep(1100)
        },
      )
    : checks
  const deezer =
    windowed.length > 0 && entry.deezerIds?.length
      ? await deezerAlbums(entry.deezerIds, lookup.fetcher)
      : { albums: [], answered: true }
  const items = releases.flatMap((built) => {
    const item = feedItem(built)
    if (!inReleaseWindow(item.date, todayIso)) return [item]
    const check = built.rgId ? nextChecks[built.rgId] : undefined
    const confirmed = confirmRelease(item, check, { deezer, ...apple }, built.kind ?? kindOf(built.rgType))
    return confirmed ? [confirmed] : []
  })
  return { items, checks: nextChecks }
}

export function startProgress(): BuildProgress {
  const list = roster as RosterEntry[]
  return {
    date: new Date().toISOString().slice(0, 10),
    cursor: 0,
    rosterLength: list.length,
    items: [],
  }
}

/**
 * Fetch one bounded slice of the roster (BATCH_SIZE artists starting at
 * progress.cursor), append their items to progress, and advance the
 * cursor. Sequential and politely throttled within the batch — sized so
 * a single call finishes well inside Netlify's 15-minute background
 * budget even with MusicBrainz/iTunes/YouTube retries, so the full
 * roster completes across several chained batches instead of stalling
 * partway through a single all-in-one pass.
 */
export interface BuildBatchOptions {
  /**
   * Called after each artist so the caller can refresh its lock. A batch
   * slowed by MusicBrainz 503 retries can outlive a fixed lock age, and
   * a tick or /feed visit landing then would start a second chain over
   * the same slice (double the external load, muddled logs).
   */
  heartbeat?: () => Promise<void>
}

export async function buildBatch(
  progress: BuildProgress,
  options: BuildBatchOptions = {},
): Promise<{ progress: BuildProgress; done: boolean }> {
  const list = roster as RosterEntry[]
  if (inRetryPass(progress, list.length)) return retryBatch(progress, list, options)
  const slice = list.slice(progress.cursor, progress.cursor + BATCH_SIZE)
  // One verdict-cache read per invocation; refreshed entries are written
  // back after the batch so only new/stale ids hit oEmbed.
  const verdicts = await readVerdicts()
  const previous = (await readSnapshot())?.items ?? []
  // A failed read must not be written back over the whole cache.
  const stored = await readChecks()
  let checks = stored.cache
  const todayIso = new Date().toISOString().slice(0, 10)
  const started = Date.now()
  const fetcher = fetcherFor(started, options.heartbeat)
  const fetched: SnapshotItem[] = []
  let retry = progress.retry ?? []
  let processed = 0
  for (const entry of slice) {
    // Past the deadline, the rest of the slice waits for the next batch
    // (the first artist always runs, so the chain always moves).
    if (processed > 0 && Date.now() - started > BATCH_DEADLINE_MS) break
    const releases = await artistReleases(entry, checks, todayIso, fetcher)
    const videos = await rssVideos(entry, fetcher)
    if (stored.read && releases.checks !== checks) await writeChecks(releases.checks)
    checks = releases.checks
    if (!releases.complete) retry = noteForRetry(retry, entry.slug)
    fetched.push(
      ...releases.items,
      ...(releases.complete ? [] : carriedReleases(entry.slug, releases.items, previous)),
      ...(await pruneDeadVideos(videos, verdicts)),
    )
    processed++
    await options.heartbeat?.()
    // MusicBrainz 1 req/s + iTunes ~20 req/min shared across the batch.
    await sleep(2600)
  }
  await writeVerdicts(verdicts)
  const items = [...progress.items, ...(await keepMinuteLong(fetched))]
  const cursor = progress.cursor + processed
  const next: BuildProgress = { ...progress, cursor, items, retry }
  return { progress: next, done: buildIsDone(next, list.length) }
}

/** Before the second try: a busy MusicBrainz often settles within a minute. */
const RETRY_COOL_DOWN_MS = 60_000

/**
 * The second try (./retryPass): each artist noted in the main pass is
 * asked once more; a full answer replaces their rows, another partial
 * one leaves the kept rows as they are. Bounded by the batch deadline —
 * the rest wait for the next batch, so the chain always moves.
 */
async function retryBatch(
  progress: BuildProgress,
  list: readonly RosterEntry[],
  options: BuildBatchOptions,
): Promise<{ progress: BuildProgress; done: boolean }> {
  const stored = await readChecks()
  let checks = stored.cache
  const todayIso = new Date().toISOString().slice(0, 10)
  const started = Date.now()
  const fetcher = fetcherFor(started, options.heartbeat)
  const pending = progress.retry ?? []
  let items = progress.items
  let unanswered = progress.unanswered ?? []
  let asked = 0
  await sleep(RETRY_COOL_DOWN_MS)
  for (const slug of pending) {
    if (asked > 0 && Date.now() - started > BATCH_DEADLINE_MS) break
    asked++
    const entry = list.find((candidate) => candidate.slug === slug)
    if (!entry) continue
    const releases = await artistReleases(entry, checks, todayIso, fetcher)
    if (stored.read && releases.checks !== checks) await writeChecks(releases.checks)
    checks = releases.checks
    if (releases.complete) items = replaceArtistReleases(items, slug, releases.items)
    else unanswered = noteForRetry(unanswered, slug)
    await options.heartbeat?.()
    await sleep(2600)
  }
  const next: BuildProgress = { ...progress, items, retry: pending.slice(asked), unanswered }
  return { progress: next, done: buildIsDone(next, list.length) }
}

/** Sort, cap, and stamp a completed progress pass as the live snapshot. */
export function finalizeSnapshot(progress: BuildProgress): FeedSnapshot {
  const items = [...progress.items].sort((a, b) => b.date.localeCompare(a.date))
  return {
    builtAt: new Date().toISOString(),
    rosterLength: progress.rosterLength,
    items: items.slice(0, MAX_ITEMS),
    releasesUnanswered: [...(progress.unanswered ?? []), ...(progress.retry ?? [])],
  }
}

/**
 * A snapshot is fresh only if it was built today (UTC) AND covers the
 * current roster. Age alone isn't enough — a same-day snapshot built
 * before new artists were added would otherwise silently block a rebuild
 * every time the roster grows. Why the UTC date and not an age window
 * (the Sep 16 skip, and what the hourly tick relies on): see builtToday
 * in ./rebuild.
 */
export function isFresh(snapshot: FeedSnapshot): boolean {
  if (snapshot.rosterLength !== ROSTER_LENGTH) return false
  return builtToday(snapshot.builtAt)
}
