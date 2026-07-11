import { NextResponse } from 'next/server'
import type {
  CountryYearDetails,
  PanelArtist,
  PanelRelease,
} from '@/lib/explore/panelData'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'
const RELEASE_LIMIT = 30
const ARTIST_LIMIT = 12

// Warm-process memoization; the CDN Cache-Control header does the real work.
const memo = new Map<string, CountryYearDetails>()

interface MbArtistCredit {
  artist?: { id: string; name: string }
}

interface MbRelease {
  id: string
  title: string
  date?: string
  'artist-credit'?: MbArtistCredit[]
}

function toDetails(body: {
  count?: number
  releases?: MbRelease[]
}): CountryYearDetails {
  const releases: PanelRelease[] = []
  const artistById = new Map<string, PanelArtist>()

  for (const release of body.releases ?? []) {
    const artist = release['artist-credit']?.[0]?.artist
    if (!artist) continue
    if (!artistById.has(artist.id) && artistById.size < ARTIST_LIMIT) {
      artistById.set(artist.id, { id: artist.id, name: artist.name })
    }
    releases.push({
      id: release.id,
      title: release.title,
      date: release.date,
      artist: { id: artist.id, name: artist.name },
    })
  }

  const sorted = [...releases].sort((a, b) =>
    (a.date ?? '9999').localeCompare(b.date ?? '9999'),
  )

  return {
    totalCount: body.count ?? 0,
    artists: [...artistById.values()],
    releases: sorted,
  }
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ country: string; year: string }> },
) {
  const { country, year } = await ctx.params

  if (!/^[A-Z]{2}$/.test(country) || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'Invalid country or year' }, { status: 400 })
  }
  const yearNum = Number(year)
  if (yearNum < 1900 || yearNum > 2100) {
    return NextResponse.json({ error: 'Year out of range' }, { status: 400 })
  }

  const key = `${country}:${year}`
  const cached = memo.get(key)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  const query = encodeURIComponent(
    `country:${country} AND date:[${year} TO ${year}-12-31]`,
  )
  const url = `https://musicbrainz.org/ws/2/release?query=${query}&limit=${RELEASE_LIMIT}&fmt=json`

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          continue
        }
        return NextResponse.json(
          { error: 'MusicBrainz rate limit' },
          { status: 429 },
        )
      }
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

      const details = toDetails(await res.json())
      memo.set(key, details)
      return withCacheHeaders(NextResponse.json(details))
    } catch (error) {
      if (attempt === 2) {
        console.error(`explore api ${key} failed:`, error)
        return NextResponse.json(
          { error: 'MusicBrainz unavailable' },
          { status: 502 },
        )
      }
    }
  }
  return NextResponse.json({ error: 'Unreachable' }, { status: 500 })
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
