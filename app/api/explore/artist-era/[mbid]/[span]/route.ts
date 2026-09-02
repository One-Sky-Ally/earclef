import { NextResponse } from 'next/server'
import type {
  ArtistEraDetails,
  ArtistEraRelease,
} from '@/lib/explore/panelData'
import { rgDatingFor, rgDatingTitleKey } from '@/lib/explore/rgDating'

/**
 * What an artist put out WITHIN an era: their MusicBrainz release
 * groups filtered by first-release date — CORRECTED by the era-dating
 * dataset (Stage 4, Sep 1 2026). MusicBrainz's first-release-date is
 * only the earliest release MB knows, which for pre-digital catalogs
 * is routinely a CD-era reissue; and a compilation is honestly dated
 * at assembly. The corrections move both to the era of the RECORDINGS:
 * a title with per-song evidence counts for its true year, and a
 * retrospective album counts for its span ("1964–1975"), leaving the
 * reissue year entirely (move-don't-copy, owner ruling). A 2020
 * re-recording is its own group, absent from the corrections, and
 * still does not leak back.
 */

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const PAGE_SIZE = 100
/** Two pages = 200 release groups; beyond that we say so honestly. */
const MAX_PAGES = 2
const MB_DELAY_MS = 1100
const RESULT_LIMIT = 40

const MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SPAN_PATTERN = /^(\d{4})(?:-(\d{4}))?$/

const memo = new Map<string, ArtistEraDetails>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface MbReleaseGroup {
  id: string
  title: string
  'first-release-date'?: string
  'primary-type'?: string
}

const MB_REQUEST_TIMEOUT_MS = 8000

async function mbJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(MB_REQUEST_TIMEOUT_MS),
    })
    if (res.status === 503 || res.status === 429) {
      if (attempt < 3) {
        await sleep(1500 * attempt)
        continue
      }
      throw new RateLimitError()
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
    return res.json()
  }
  throw new Error('unreachable')
}

class RateLimitError extends Error {}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ mbid: string; span: string }> },
) {
  const { mbid, span } = await ctx.params
  const spanMatch = SPAN_PATTERN.exec(span)
  if (!MBID_PATTERN.test(mbid) || !spanMatch) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const start = Number(spanMatch[1])
  const end = spanMatch[2] ? Number(spanMatch[2]) : start
  if (start < 1900 || end > 2100 || start > end) {
    return NextResponse.json({ error: 'Year out of range' }, { status: 400 })
  }

  const key = `${mbid}:${span}`
  const cached = memo.get(key)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  const dating = await rgDatingFor(mbid)

  try {
    const groups: MbReleaseGroup[] = []
    let catalogCount = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = (await mbJson(
        `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fmt=json`,
      )) as {
        'release-group-count'?: number
        'release-groups'?: MbReleaseGroup[]
      }
      catalogCount = body['release-group-count'] ?? 0
      groups.push(...(body['release-groups'] ?? []))
      if (catalogCount <= (page + 1) * PAGE_SIZE) break
      await sleep(MB_DELAY_MS)
    }

    const eraReleases: ArtistEraRelease[] = groups
      .flatMap((group) => {
        const date = group['first-release-date'] ?? ''
        const mbYear = Number(date.slice(0, 4))
        const songYear = dating?.s[rgDatingTitleKey(group.title)]
        const albumSpan = dating?.a[group.id]
        // Corrected range, else MusicBrainz's own year.
        const lo =
          songYear ?? albumSpan?.[0] ?? (Number.isFinite(mbYear) ? mbYear : NaN)
        const hi = songYear ?? albumSpan?.[1] ?? lo
        if (!Number.isFinite(lo)) return []
        // A corrected group counts ONLY where its true era lies — it has
        // LEFT its reissue year (move-don't-copy). Uncorrected groups
        // behave exactly as before.
        if (hi < start || lo > end) return []
        return [
          {
            id: group.id,
            title: group.title,
            date: String(lo),
            type: group['primary-type'] ?? undefined,
            ...(albumSpan && songYear === undefined
              ? { originalSpan: albumSpan, editionYear: mbYear }
              : {}),
            ...(songYear !== undefined && Number.isFinite(mbYear)
              ? { editionYear: mbYear }
              : {}),
          },
        ]
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    const details: ArtistEraDetails = {
      eraReleases: eraReleases.slice(0, RESULT_LIMIT),
      eraCount: eraReleases.length,
      catalogCount,
      truncated: catalogCount > MAX_PAGES * PAGE_SIZE,
    }
    memo.set(key, details)
    return withCacheHeaders(NextResponse.json(details))
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'MusicBrainz rate limit' },
        { status: 429 },
      )
    }
    console.error(`artist-era ${key} failed:`, error)
    return NextResponse.json(
      { error: 'MusicBrainz unavailable' },
      { status: 502 },
    )
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
