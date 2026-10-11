/**
 * YouTube Data API helpers shared by the queue resolver
 * (app/api/queue/artist/[mbid]/[decade]/route.ts, where they were born)
 * and the Discover song resolver (lib/discover/song.ts). Moved here
 * unchanged in behaviour on Oct 11 2026 so both paths spend quota the
 * same way and pass the same playability bar.
 *
 * Relative imports only: bundled into the Netlify background function.
 */
import { isSongLength } from './contentGates'

/**
 * Upload pages (of 50) scanned on the artist's own channel. Raised
 * 2 → 4 with multi-track (Aug 31, 2026): the window, not the matching,
 * was the yield limit — a deep catalogue can't be found in 100 uploads.
 * Costs 1 unit per page and is SELF-TARGETING: the scan stops at the
 * last page, so small channels still cost 1-2 units and only prolific
 * ones pay 4 — exactly the artists with more songs to give.
 */
export const UPLOAD_PAGES = 4

export class QuotaError extends Error {}

export async function ytJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[] }
    }
    const reason = body.error?.errors?.[0]?.reason ?? ''
    if (reason.includes('quota') || reason.includes('rateLimit')) {
      throw new QuotaError()
    }
    throw new Error('YouTube 403')
  }
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`)
  return res.json()
}

/** YouTube API titles arrive HTML-encoded; store them as plain text. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** The artist's MB-linked YouTube channel URL, if curated. */
export function youtubeRel(
  relations: { url?: { resource?: string } }[] | undefined,
): string | null {
  for (const relation of relations ?? []) {
    const resource = relation.url?.resource
    if (!resource) continue
    try {
      const host = new URL(resource).hostname.replace(/^www\.|^m\./, '')
      if (host === 'youtube.com') return resource
    } catch {
      // Malformed URL in MB — skip.
    }
  }
  return null
}

/** Resolve a channel URL to its ID: free for /channel/UC…, 1 unit else. */
export async function channelId(url: string, key: string): Promise<string | null> {
  const direct = url.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/)
  if (direct) return direct[1]
  const handle = url.match(/\/(@[^/?]+)/)
  const user = url.match(/\/user\/([^/?]+)/)
  const param = handle
    ? `forHandle=${encodeURIComponent(handle[1])}`
    : user
      ? `forUsername=${encodeURIComponent(user[1])}`
      : null
  if (!param) return null
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/channels?part=id&${param}&key=${key}`,
  )) as { items?: { id?: string }[] }
  return body.items?.[0]?.id ?? null
}

export interface Upload {
  videoId: string
  title: string
}

/** Uploads scan: 1 unit per page of 50 — the cheap path. */
export async function channelUploads(id: string, key: string): Promise<Upload[]> {
  const playlist = `UU${id.slice(2)}`
  const pages: Upload[][] = []
  let pageToken = ''
  for (let page = 0; page < UPLOAD_PAGES; page++) {
    const body = (await ytJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlist}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}&key=${key}`,
    )) as {
      nextPageToken?: string
      items?: {
        snippet?: { title?: string; resourceId?: { videoId?: string } }
      }[]
    }
    pages.push(
      (body.items ?? []).flatMap((item) => {
        const videoId = item.snippet?.resourceId?.videoId
        const title = item.snippet?.title
        return videoId && title ? [{ videoId, title }] : []
      }),
    )
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }
  return pages.flat()
}

/** What videos.list tells us about a candidate beyond playability. */
export interface VideoFacts {
  description?: string
  topicUrls?: string[]
  channelTitle?: string
}

/**
 * Playability gate: public + embeddable + long enough to be a record.
 * BATCHED — videos.list takes up to 50 ids for ONE unit, so checking a
 * dozen candidates costs less than the old one-at-a-time walk over
 * three. Returns the subset of ids that pass, order not guaranteed.
 *
 * The duration floor is half of standing lesson 7: a title match
 * cannot tell a Short or a clip from the song it names.
 */
export async function playableSet(
  videoIds: string[],
  key: string,
): Promise<{ playable: Set<string>; meta: Map<string, VideoFacts> }> {
  const playable = new Set<string>()
  const meta = new Map<string, VideoFacts>()
  if (videoIds.length === 0) return { playable, meta }
  // `snippet` and `topicDetails` ride along FREE: videos.list costs one
  // unit per call whatever parts are asked for, and this call already
  // happens for every candidate.
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails,topicDetails&id=${videoIds.slice(0, 50).join(',')}&key=${key}`,
  )) as {
    items?: {
      id?: string
      snippet?: { title?: string; description?: string; channelTitle?: string }
      status?: { embeddable?: boolean; privacyStatus?: string }
      contentDetails?: { duration?: string }
      topicDetails?: { topicCategories?: string[] }
    }[]
  }
  for (const item of body.items ?? []) {
    // Missing id can't identify anything — missing is not a match.
    if (!item.id) continue
    meta.set(item.id, {
      description: item.snippet?.description,
      topicUrls: item.topicDetails?.topicCategories,
      channelTitle: item.snippet?.channelTitle,
    })
    if (
      item.status?.embeddable &&
      item.status.privacyStatus === 'public' &&
      isSongLength(item.contentDetails?.duration)
    ) {
      playable.add(item.id)
    }
  }
  return { playable, meta }
}
