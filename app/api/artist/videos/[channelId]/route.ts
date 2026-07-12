import { NextResponse } from 'next/server'
import type {
  BrowserCategory,
  VideoItem,
  VideosResponse,
} from '@/lib/artist/browserData'

const CHANNEL_PATTERN = /^UC[\w-]{22}$/
const MAX_API_PAGES = 4

const memo = new Map<string, VideosResponse>()

const CATEGORY_LABELS: Record<string, string> = {
  main: 'Main releases',
  live: 'Live',
  interviews: 'Interviews',
  other: 'Other',
}

function categoryOf(title: string): string {
  const lower = title.toLowerCase()
  if (/interview|q&a|q & a|in conversation/.test(lower)) return 'interviews'
  if (/\blive\b|concert|festival|unplugged|session/.test(lower)) return 'live'
  if (/official|music video|lyric video|visuali[sz]er|\baudio\b/.test(lower)) {
    return 'main'
  }
  return 'other'
}

function categorize(items: VideoItem[]): BrowserCategory<VideoItem>[] {
  const buckets = new Map<string, VideoItem[]>()
  for (const item of items) {
    const key = categoryOf(item.title)
    const list = buckets.get(key) ?? []
    list.push(item)
    buckets.set(key, list)
  }
  return Object.keys(CATEGORY_LABELS)
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: CATEGORY_LABELS[key], items: buckets.get(key)! }))
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

async function fromRss(channelId: string): Promise<VideoItem[]> {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
  )
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match): VideoItem | null => {
      const videoId = match[1].match(/<yt:videoId>([^<]+)/)?.[1]
      const title = match[1].match(/<title>([^<]*)<\/title>/)?.[1]
      if (!videoId || !title) return null
      const item: VideoItem = { videoId, title: decodeXml(title) }
      const publishedAt = match[1].match(/<published>([^<]+)/)?.[1]
      if (publishedAt) item.publishedAt = publishedAt
      return item
    })
    .filter((item): item is VideoItem => item !== null)
}

async function fromApi(channelId: string, key: string): Promise<VideoItem[]> {
  // A channel's uploads playlist is its id with the UC prefix swapped for UU.
  const playlistId = `UU${channelId.slice(2)}`
  const items: VideoItem[] = []
  let pageToken = ''

  for (let page = 0; page < MAX_API_PAGES; page++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('playlistId', playlistId)
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('key', key)
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url)
    if (!res.ok) throw new Error(`YouTube API HTTP ${res.status}`)
    const body = (await res.json()) as {
      nextPageToken?: string
      items?: {
        snippet?: {
          title?: string
          publishedAt?: string
          resourceId?: { videoId?: string }
        }
      }[]
    }
    for (const item of body.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      if (videoId && title) {
        items.push({ videoId, title, publishedAt: item.snippet?.publishedAt })
      }
    }
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }
  return items
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params
  if (!CHANNEL_PATTERN.test(channelId)) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
  }

  const cached = memo.get(channelId)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  const apiKey = process.env.YOUTUBE_API_KEY

  try {
    let response: VideosResponse
    if (apiKey) {
      try {
        const items = await fromApi(channelId, apiKey)
        response = { source: 'api', partial: false, categories: categorize(items) }
      } catch (error) {
        console.error(`videos api ${channelId} failed, using RSS:`, error)
        const items = await fromRss(channelId)
        response = { source: 'rss', partial: true, categories: categorize(items) }
      }
    } else {
      const items = await fromRss(channelId)
      response = { source: 'rss', partial: true, categories: categorize(items) }
    }
    memo.set(channelId, response)
    return withCacheHeaders(NextResponse.json(response))
  } catch (error) {
    console.error(`videos ${channelId} failed:`, error)
    return NextResponse.json({ error: 'Videos unavailable' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=86400, stale-while-revalidate=604800',
  )
  return response
}
