import { NextResponse } from 'next/server'
import { getStore } from '@netlify/blobs'
import { queueCacheKey } from '@/lib/play/resolve'

/**
 * Play-queue resolver: ONE artist → their era-correct playable video.
 *
 * The place+era queue is a deterministic client-side walk of the
 * panel's popularity pool; this route does the per-artist work —
 * era-picking a track from MusicBrainz release-group dates, then
 * finding it on the artist's OWN channel (MB url-rels) or via one
 * capped YouTube search restricted to exact-channel-name / Topic
 * matches. Never invented: every candidate passes a videos.list
 * playability check (public + embeddable) before it ships.
 *
 * Results cache PERMANENTLY in Blobs (nulls retry after 30 days) and
 * ride a 30-day CDN header — an artist resolved for Jamaica's 1970s
 * serves every early-70s combo forever. Quota exhaustion is returned
 * as {quota:true} and never cached, so queues finish brewing on a
 * later day. Zero Anthropic wallet: MusicBrainz + YouTube only.
 */

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DECADE = /^(19|20)\d0$/
const MB_DELAY_MS = 1100
/** How many upload pages (of 50) to scan on the artist's own channel. */
const UPLOAD_PAGES = 2
const NULL_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface QueueTrack {
  videoId: string
  title: string
  /** 'channel' = artist's MB-linked channel; 'search' = verified search. */
  source: 'channel' | 'search'
  /** How era-true the pick is: in-era | nearby (±10y) | catalog. */
  era: 'in-era' | 'nearby' | 'catalog'
}

interface CachedResolve {
  at: string
  track: QueueTrack | null
}

function store() {
  return getStore({ name: 'queue', consistency: 'eventual' })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** YouTube API titles arrive HTML-encoded; store them as plain text. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Script-aware: the ASCII-only version reduced non-Latin names AND
 * channel titles to '', and '' === '' passed the official-channel bar
 * — the empty-string cousin of the Alexandra fuzzy-match failure.
 */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

async function mbJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 503 || res.status === 429) {
      await sleep(1400 * attempt)
      continue
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
    return res.json()
  }
  throw new Error('MusicBrainz rate limited')
}

interface MbReleaseGroup {
  title?: string
  'first-release-date'?: string
  'primary-type'?: string
}

/**
 * The era pick: a release-group title the artist actually put out in
 * the decade (singles beat EPs beat albums; closest to mid-decade),
 * else the nearest dated work within ±10 years, else nothing (the
 * search falls back to their catalog).
 */
function pickEraTitle(
  groups: MbReleaseGroup[],
  decade: number,
): { title: string; era: 'in-era' | 'nearby' } | null {
  const dated = groups.flatMap((group) => {
    const year = Number(group['first-release-date']?.slice(0, 4))
    return group.title && Number.isFinite(year)
      ? [{ title: group.title, year, type: group['primary-type'] ?? '' }]
      : []
  })
  const mid = decade + 5
  const inEra = dated.filter((g) => g.year >= decade && g.year <= decade + 9)
  if (inEra.length > 0) {
    const typeRank = (type: string) =>
      type === 'Single' ? 0 : type === 'EP' ? 1 : type === 'Album' ? 2 : 3
    inEra.sort(
      (a, b) =>
        typeRank(a.type) - typeRank(b.type) ||
        Math.abs(a.year - mid) - Math.abs(b.year - mid),
    )
    return { title: inEra[0].title, era: 'in-era' }
  }
  const nearby = dated
    .filter((g) => Math.abs(g.year - mid) <= 15)
    .sort((a, b) => Math.abs(a.year - mid) - Math.abs(b.year - mid))
  return nearby.length > 0 ? { title: nearby[0].title, era: 'nearby' } : null
}

/** The artist's MB-linked YouTube channel URL, if curated. */
function youtubeRel(
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

class QuotaError extends Error {}

async function ytJson(url: string): Promise<unknown> {
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

/** Resolve a channel URL to its ID: free for /channel/UC…, 1 unit else. */
async function channelId(url: string, key: string): Promise<string | null> {
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

interface Upload {
  videoId: string
  title: string
}

/** Uploads scan: 1 unit per page of 50 — the cheap path. */
async function channelUploads(id: string, key: string): Promise<Upload[]> {
  const playlist = `UU${id.slice(2)}`
  const uploads: Upload[] = []
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
    for (const item of body.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      if (videoId && title) uploads.push({ videoId, title })
    }
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }
  return uploads
}

interface SearchHit {
  videoId: string
  title: string
  channelTitle: string
}

/** The expensive fallback: ONE search (100 units), channel-verified. */
async function searchVerified(
  artistName: string,
  trackTitle: string | null,
  key: string,
): Promise<SearchHit[]> {
  const q = trackTitle ? `${artistName} ${trackTitle}` : artistName
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(q)}&key=${key}`,
  )) as {
    items?: {
      id?: { videoId?: string }
      snippet?: { title?: string; channelTitle?: string }
    }[]
  }
  const artist = normalize(artistName)
  // An empty normalized name can only match everything or nothing —
  // it verifies nothing, so it matches nothing.
  if (!artist) return []
  return (body.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId
    const title = item.snippet?.title
    const channelTitle = item.snippet?.channelTitle ?? ''
    if (!videoId || !title) return []
    const channel = normalize(channelTitle.replace(/ - topic$/i, ''))
    // Official-only bar: the uploader IS the artist (own channel or
    // the label-backed "Artist - Topic" channel). Fan uploads fail it.
    return channel === artist ? [{ videoId, title, channelTitle }] : []
  })
}

/** Playability gate: public + embeddable, per videos.list (1 unit). */
async function playable(videoId: string, key: string): Promise<boolean> {
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}&key=${key}`,
  )) as {
    items?: {
      status?: { embeddable?: boolean; privacyStatus?: string }
    }[]
  }
  const status = body.items?.[0]?.status
  return Boolean(status?.embeddable && status.privacyStatus === 'public')
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ mbid: string; decade: string }> },
) {
  const { mbid, decade } = await ctx.params
  const name = new URL(request.url).searchParams.get('name')?.trim() ?? ''
  if (!UUID.test(mbid) || !DECADE.test(decade) || !name || name.length > 200) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const decadeYear = Number(decade)
  const key = queueCacheKey(mbid, decade, name)

  try {
    const cached = (await store().get(key, {
      type: 'json',
    })) as CachedResolve | null
    if (
      cached &&
      (cached.track !== null ||
        Date.now() - Date.parse(cached.at) < NULL_TTL_MS)
    ) {
      return withCacheHeaders(NextResponse.json({ track: cached.track }))
    }
  } catch {
    // Cache read failure — resolve live.
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Queue unavailable' }, { status: 501 })
  }

  try {
    // 1. Era pick from MusicBrainz release-group dates.
    const groupsBody = (await mbJson(
      `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`,
    )) as { 'release-groups'?: MbReleaseGroup[] }
    const pick = pickEraTitle(groupsBody['release-groups'] ?? [], decadeYear)
    await sleep(MB_DELAY_MS)

    // 2. The artist's own channel, when MusicBrainz curates one.
    const relsBody = (await mbJson(
      `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`,
    )) as { relations?: { url?: { resource?: string } }[] }
    const channelUrl = youtubeRel(relsBody.relations)

    const candidates: { videoId: string; title: string; source: QueueTrack['source'] }[] = []

    if (channelUrl && pick) {
      const id = await channelId(channelUrl, apiKey)
      if (id) {
        const uploads = await channelUploads(id, apiKey)
        const wanted = normalize(pick.title)
        // Title containment is safe HERE only because the channel is
        // the artist's own MB-linked one — it picks WHICH video, never
        // WHO. An empty wanted would match every upload, so it skips.
        for (const upload of wanted ? uploads : []) {
          if (normalize(upload.title).includes(wanted)) {
            candidates.push({ ...upload, source: 'channel' })
            if (candidates.length >= 2) break
          }
        }
      }
    }

    if (candidates.length === 0) {
      const hits = await searchVerified(name, pick?.title ?? null, apiKey)
      for (const hit of hits.slice(0, 3)) {
        candidates.push({
          videoId: hit.videoId,
          title: hit.title,
          source: 'search',
        })
      }
    }

    let track: QueueTrack | null = null
    for (const candidate of candidates.slice(0, 3)) {
      if (await playable(candidate.videoId, apiKey)) {
        track = {
          videoId: candidate.videoId,
          title: decodeEntities(candidate.title),
          source: candidate.source,
          era: pick?.era ?? 'catalog',
        }
        break
      }
    }

    try {
      await store().setJSON(key, {
        at: new Date().toISOString(),
        track,
      } satisfies CachedResolve)
    } catch {
      // Cache writes are best-effort.
    }
    return withCacheHeaders(NextResponse.json({ track }))
  } catch (error) {
    if (error instanceof QuotaError) {
      // Never cached — the queue finishes brewing another day.
      return NextResponse.json({ quota: true }, { status: 503 })
    }
    console.error(`queue resolve ${mbid}/${decade} failed:`, error)
    return NextResponse.json({ error: 'Resolve failed' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
