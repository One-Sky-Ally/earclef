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
  listenSearch,
  youtubeThumbnailUrl,
  youtubeThumbnailLargeUrl,
  youtubeWatchUrl,
} from '../links'
import { normalizedTitle } from './blurbKey'
import roster from '../discover/roster.json'

export interface SnapshotItem {
  type: 'release' | 'video'
  slug: string
  artistName: string
  title: string
  date: string
  image: string
  imageLarge?: string
  href: string
}

export interface FeedSnapshot {
  builtAt: string
  items: SnapshotItem[]
}

const SNAPSHOT_KEY = 'snapshot/v1'
const USER_AGENT =
  'EarClefFeed/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const VIDEOS_PER_ARTIST = 8
const MAX_ITEMS = 600

let devSnapshot: FeedSnapshot | null = null

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchWithRetry(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if ((res.status === 503 || res.status === 429) && attempt < 3) {
        await sleep(2000 * attempt)
        continue
      }
      return res
    } catch {
      if (attempt === 3) return null
      await sleep(2000 * attempt)
    }
  }
  return null
}

interface RosterEntry {
  slug: string
  name: string
  mbid: string | null
  channelId: string | null
  itunesId: string | null
}

async function mbReleases(entry: RosterEntry): Promise<SnapshotItem[]> {
  if (!entry.mbid) return []
  const items: SnapshotItem[] = []
  interface MbRg {
    id: string
    title: string
    'first-release-date'?: string
  }
  for (let offset = 0; offset < 300; offset += 100) {
    const res = await fetchWithRetry(
      `https://musicbrainz.org/ws/2/release-group?artist=${entry.mbid}&limit=100&offset=${offset}&fmt=json`,
    )
    if (!res?.ok) break
    const body = (await res.json()) as {
      'release-group-count': number
      'release-groups': MbRg[]
    }
    for (const rg of body['release-groups']) {
      const date = rg['first-release-date']
      if (!date) continue
      items.push({
        type: 'release',
        slug: entry.slug,
        artistName: entry.name,
        title: rg.title,
        date,
        image: coverArtUrl(rg.id),
        imageLarge: coverArtUrlLarge(rg.id),
        href: listenSearch(entry.name, rg.title),
      })
    }
    if (offset + 100 >= body['release-group-count']) break
    await sleep(1100)
  }
  return items
}

async function itunesReleases(entry: RosterEntry): Promise<SnapshotItem[]> {
  if (!entry.itunesId) return []
  const res = await fetchWithRetry(
    `https://itunes.apple.com/lookup?id=${entry.itunesId}&entity=album&limit=200&sort=recent`,
  )
  if (!res?.ok) return []
  interface ItunesCollection {
    wrapperType?: string
    collectionName?: string
    releaseDate?: string
    artworkUrl100?: string
  }
  const body = (await res.json()) as { results?: ItunesCollection[] }
  return (body.results ?? [])
    .filter(
      (result) =>
        result.wrapperType === 'collection' &&
        result.collectionName &&
        result.releaseDate,
    )
    .map((result) => ({
      type: 'release' as const,
      slug: entry.slug,
      artistName: entry.name,
      title: result.collectionName!.replace(/ - (Single|EP)$/i, ''),
      date: result.releaseDate!.slice(0, 10),
      image: result.artworkUrl100 ?? '/images/hero-placeholder.svg',
      imageLarge: result.artworkUrl100?.replace('100x100', '600x600'),
      href: listenSearch(entry.name, result.collectionName!),
    }))
}

async function rssVideos(entry: RosterEntry): Promise<SnapshotItem[]> {
  if (!entry.channelId) return []
  const res = await fetchWithRetry(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${entry.channelId}`,
  )
  if (!res?.ok) return []
  const xml = await res.text()
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  return entries
    .flatMap((match) => {
      const block = match[1]
      const videoId = block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1]
      const title = block
        .match(/<title>([\s\S]*?)<\/title>/)?.[1]
        ?.replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
      const published = block.match(/<published>([\d-]{10})/)?.[1]
      if (!videoId || !title || !published) return []
      return [
        {
          type: 'video' as const,
          slug: entry.slug,
          artistName: entry.name,
          title,
          date: published,
          image: youtubeThumbnailUrl(videoId),
          imageLarge: youtubeThumbnailLargeUrl(videoId),
          href: youtubeWatchUrl(videoId),
        },
      ]
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, VIDEOS_PER_ARTIST)
}

/** iTunes overlay wins duplicate titles (release-day dates on new drops). */
function mergeReleases(
  overlay: SnapshotItem[],
  musicbrainz: SnapshotItem[],
): SnapshotItem[] {
  const seen = new Map<string, SnapshotItem>()
  for (const item of [...overlay, ...musicbrainz]) {
    const key = normalizedTitle(item.title)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()]
}

/**
 * Full roster pass. Sequential and politely throttled — built for the
 * 15-minute background-function budget, not a request cycle.
 */
export async function buildSnapshot(): Promise<FeedSnapshot> {
  const items: SnapshotItem[] = []
  for (const entry of roster as RosterEntry[]) {
    const [mb, overlay, videos] = [
      await mbReleases(entry),
      await itunesReleases(entry),
      await rssVideos(entry),
    ]
    items.push(...mergeReleases(overlay, mb), ...videos)
    // MusicBrainz 1 req/s + iTunes ~20 req/min shared across the loop.
    await sleep(2600)
  }
  items.sort((a, b) => b.date.localeCompare(a.date))
  return { builtAt: new Date().toISOString(), items: items.slice(0, MAX_ITEMS) }
}

export function isFresh(snapshot: FeedSnapshot): boolean {
  return Date.now() - Date.parse(snapshot.builtAt) < 26 * 60 * 60 * 1000
}
