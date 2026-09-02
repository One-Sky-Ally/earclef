import { NextResponse } from 'next/server'

/**
 * One artist's CORE FACTS from MusicBrainz — the spine of the archive
 * card at /a/[mbid]. Every field here is a value MusicBrainz records,
 * copied across unchanged: name, the editors' disambiguation comment,
 * whether it is a person or a group, where they are from, when they
 * were active, and their genre labels.
 *
 * Nothing is inferred, summarised or written. There is no biography in
 * this response because there is no biography to verify — an archive
 * card states what a source says, or says nothing.
 *
 * Cached hard (warm-process memo + a long CDN header) because these
 * facts change on the scale of years and MusicBrainz is rate-limited
 * to roughly one request a second.
 */

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MB_TIMEOUT_MS = 8000
/** Genre labels shown on the card — the long tail is noise. */
const MAX_GENRES = 8
/** A tag needs more than one voter before it is worth repeating. */
const MIN_TAG_COUNT = 2

export interface ArchiveArtistFacts {
  mbid: string
  name: string
  /** MusicBrainz's own short qualifier, e.g. "Malian singer". */
  disambiguation?: string
  /** "Person" | "Group" | … as MusicBrainz types it. */
  type?: string
  /** ISO 3166-1 alpha-2 — what the globe is keyed on. */
  countryCode?: string
  countryName?: string
  /** More precise origin than the country, when MB records one. */
  beginArea?: string
  beginYear?: number
  endYear?: number
  /** True when MusicBrainz marks the life-span ended. */
  ended?: boolean
  genres: string[]
}

interface MbArea {
  name?: string
  'iso-3166-1-codes'?: string[]
}
interface MbArtist {
  name?: string
  disambiguation?: string
  type?: string
  country?: string
  area?: MbArea
  'begin-area'?: MbArea
  'life-span'?: { begin?: string; end?: string; ended?: boolean }
  genres?: { name?: string; count?: number }[]
  tags?: { name?: string; count?: number }[]
}

const memo = new Map<string, ArchiveArtistFacts>()

/** Leading four digits of an MB date ("1939-10-31" → 1939). */
function yearOf(date: string | undefined): number | undefined {
  const match = /^(\d{4})/.exec(date ?? '')
  return match ? Number(match[1]) : undefined
}

/**
 * Genre labels: MusicBrainz's curated genres first, falling back to
 * user tags with more than one voter. A single-voter tag is one
 * person's opinion, not a label worth restating as fact.
 */
function labelsOf(artist: MbArtist): string[] {
  const genres = (artist.genres ?? [])
    .filter((entry) => entry.name)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((entry) => entry.name as string)
  if (genres.length > 0) return genres.slice(0, MAX_GENRES)

  return (artist.tags ?? [])
    .filter((entry) => entry.name && (entry.count ?? 0) >= MIN_TAG_COUNT)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((entry) => entry.name as string)
    .slice(0, MAX_GENRES)
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=604800, stale-while-revalidate=2592000',
  )
  return response
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ mbid: string }> },
) {
  const { mbid } = await ctx.params
  if (!UUID.test(mbid)) {
    return NextResponse.json({ error: 'Invalid artist id' }, { status: 400 })
  }

  const cached = memo.get(mbid)
  if (cached) return withCacheHeaders(NextResponse.json(cached))

  const url = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=tags+genres&fmt=json`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(MB_TIMEOUT_MS),
    })
    if (res.status === 404) {
      return NextResponse.json({ error: 'Unknown artist' }, { status: 404 })
    }
    if (res.status === 503 || res.status === 429) {
      return NextResponse.json(
        { error: 'MusicBrainz is busy right now' },
        { status: 429 },
      )
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)

    const artist = (await res.json()) as MbArtist
    if (!artist.name) {
      return NextResponse.json({ error: 'Unknown artist' }, { status: 404 })
    }

    const area = artist.area
    const facts: ArchiveArtistFacts = {
      mbid,
      name: artist.name,
      ...(artist.disambiguation && { disambiguation: artist.disambiguation }),
      ...(artist.type && { type: artist.type }),
      // The country field and the area's ISO code are the same fact from
      // two places; either will do, neither is invented.
      ...((artist.country ?? area?.['iso-3166-1-codes']?.[0]) && {
        countryCode: artist.country ?? area?.['iso-3166-1-codes']?.[0],
      }),
      ...(area?.name && { countryName: area.name }),
      ...(artist['begin-area']?.name && {
        beginArea: artist['begin-area'].name,
      }),
      ...(yearOf(artist['life-span']?.begin) !== undefined && {
        beginYear: yearOf(artist['life-span']?.begin),
      }),
      ...(yearOf(artist['life-span']?.end) !== undefined && {
        endYear: yearOf(artist['life-span']?.end),
      }),
      ...(artist['life-span']?.ended !== undefined && {
        ended: artist['life-span'].ended,
      }),
      genres: labelsOf(artist),
    }

    memo.set(mbid, facts)
    return withCacheHeaders(NextResponse.json(facts))
  } catch (error) {
    console.error('Archive artist lookup failed:', error)
    return NextResponse.json(
      { error: 'Could not reach MusicBrainz' },
      { status: 502 },
    )
  }
}
