import { NextResponse } from 'next/server'
import type {
  SpotifyRelease,
  SpotifyReleasesResponse,
} from '@/lib/artist/browserData'

const ID_PATTERN = /^[0-9A-Za-z]{22}$/
const MEMO_TTL_MS = 60 * 60 * 1000

const memo = new Map<
  string,
  { response: SpotifyReleasesResponse; at: number }
>()

let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID
  const secret = process.env.SPOTIFY_CLIENT_SECRET
  if (!id || !secret) return null
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`)
  const body = (await res.json()) as {
    access_token: string
    expires_in: number
  }
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  }
  return body.access_token
}

interface SpotifyAlbum {
  name: string
  release_date?: string
  images?: { url: string; width: number }[]
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ spotifyId: string }> },
) {
  const { spotifyId } = await ctx.params
  if (!ID_PATTERN.test(spotifyId)) {
    return NextResponse.json({ error: 'Invalid artist id' }, { status: 400 })
  }

  const cached = memo.get(spotifyId)
  if (cached && Date.now() - cached.at < MEMO_TTL_MS) {
    return withCacheHeaders(NextResponse.json(cached.response))
  }

  try {
    const token = await getToken()
    if (!token) {
      // Overlay not configured — callers fall back to MusicBrainz alone.
      return NextResponse.json({ error: 'Not configured' }, { status: 501 })
    }

    const items: SpotifyRelease[] = []
    for (const offset of [0, 50]) {
      const res = await fetch(
        `https://api.spotify.com/v1/artists/${spotifyId}/albums?include_groups=album,single,compilation&market=US&limit=50&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.status === 429) {
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`)
      const body = (await res.json()) as {
        items?: SpotifyAlbum[]
        next?: string | null
      }
      for (const album of body.items ?? []) {
        if (!album.release_date) continue
        items.push({
          title: album.name,
          date: album.release_date,
          image:
            album.images?.find((img) => img.width <= 320)?.url ??
            album.images?.[0]?.url,
        })
      }
      if (!body.next) break
    }

    items.sort((a, b) => b.date.localeCompare(a.date))
    const response: SpotifyReleasesResponse = { items: items.slice(0, 60) }
    memo.set(spotifyId, { response, at: Date.now() })
    return withCacheHeaders(NextResponse.json(response))
  } catch (error) {
    console.error(`spotify releases ${spotifyId} failed:`, error)
    return NextResponse.json({ error: 'Unavailable' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  )
  return response
}
