/**
 * Discogs reader for Discover songs. Its one consumer is the LOCAL
 * stocking run in /refresh-earclef (scripts/discover-stock.mjs), which
 * passes the owner's DISCOGS_TOKEN from .env.local (owner go, Oct 15
 * 2026): authenticated calls answer 60 a minute, so they are spaced
 * ~1 s apart. Without a token (DISCOGS_TOKEN never reaches Netlify)
 * the public endpoints answer 25 a minute per IP and calls are spaced
 * 2.5 s. A 429 is waited out ONCE; anything else returns what was
 * gathered so far. Never runs on a visitor's request.
 *
 * What is read: the artist's release listing (main credits only, newest
 * first — official videos are a recent-decades thing), then up to
 * MAX_RECORDS records: a master (its videos aggregate every pressing)
 * or a masterless release. Records arrive in the shape the identity
 * bar in ./songIdentity reads.
 *
 * Relative imports only: bundled into the Netlify background function.
 */
import type { DiscogsRecord } from './songIdentity'

const USER_AGENT = 'EarClefDiscover/0.1 +https://earclef.com'
const API = 'https://api.discogs.com'
/** 25 calls/min unauthenticated: one every 2.5 s, with headroom. */
const CALL_SPACING_MS = 2500
/** 60 calls/min with a personal token: one every 1.1 s. */
const TOKEN_SPACING_MS = 1100

/** Read per call, so a script can set it after this module loads. */
const discogsToken = () => process.env.DISCOGS_TOKEN || null
const RATE_LIMIT_WAIT_MS = 35_000
/** Records read per artist by default: ~11 calls. */
export const MAX_RECORDS = 10

const YOUTUBE_ID = /[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Listing {
  releases?: {
    id?: number
    type?: 'master' | 'release'
    role?: string
    title?: string
    year?: number
    label?: string
  }[]
}

interface ApiCredit {
  id?: number
}

interface ApiRecord {
  id?: number
  title?: string
  year?: number
  artists?: ApiCredit[]
  labels?: { name?: string }[]
  tracklist?: {
    type_?: string
    title?: string
    duration?: string
    artists?: ApiCredit[]
  }[]
  videos?: { uri?: string; title?: string; duration?: number }[]
}

export interface DiscogsReadOptions {
  /** Epoch ms after which no further call is made. */
  deadline: number
  /** Records read at most (default MAX_RECORDS; the local stocking run reads deeper). */
  maxRecords?: number
  /**
   * Stop reading once this says the records so far are enough (the
   * caller counts VERIFIED songs, not raw videos), so a well-documented
   * artist costs few calls and one whose videos sit on older records
   * gets the deeper read.
   */
  enough?: (records: readonly DiscogsRecord[]) => boolean
  /** Listed titles to read first (the pick's knownFor), exact match. */
  preferTitles?: readonly string[]
}

class DiscogsClient {
  private lastCallAt = 0
  private rateLimited = false
  private readonly deadline: number

  constructor(deadline: number) {
    this.deadline = deadline
  }

  async get(path: string): Promise<unknown | null> {
    if (Date.now() > this.deadline) return null
    const token = discogsToken()
    const wait = this.lastCallAt + (token ? TOKEN_SPACING_MS : CALL_SPACING_MS) - Date.now()
    if (wait > 0) await sleep(wait)
    this.lastCallAt = Date.now()
    try {
      const res = await fetch(`${API}${path}`, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(token ? { Authorization: `Discogs token=${token}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 429 && !this.rateLimited) {
        // Shared egress can spend the per-IP allowance: wait it out once.
        this.rateLimited = true
        await sleep(RATE_LIMIT_WAIT_MS)
        return this.get(path)
      }
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }
}

function creditIds(credits: ApiCredit[] | undefined): number[] {
  return (credits ?? []).flatMap((credit) =>
    Number.isInteger(credit.id) && (credit.id ?? 0) > 0 ? [credit.id as number] : [],
  )
}

function shapeRecord(body: ApiRecord, labels: readonly string[]): DiscogsRecord | null {
  if (!body.id || !body.title) return null
  return {
    id: body.id,
    title: body.title,
    year: Number.isInteger(body.year) && (body.year ?? 0) > 0 ? (body.year as number) : null,
    artists: creditIds(body.artists),
    tracklist: (body.tracklist ?? []).flatMap((row) =>
      row.title && row.type_ !== 'heading'
        ? [{ title: row.title, duration: row.duration ?? null, artists: creditIds(row.artists) }]
        : [],
    ),
    videos: (body.videos ?? []).flatMap((video) => {
      const match = (video.uri ?? '').match(YOUTUBE_ID)
      const videoId = match?.[1] ?? match?.[2]
      return videoId
        ? [{ videoId, title: video.title ?? '', duration: video.duration ?? null }]
        : []
    }),
    labels: [
      ...new Set([...labels, ...(body.labels ?? []).flatMap((label) => (label.name ? [label.name] : []))]),
    ],
  }
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The artist's video-bearing records, newest first, plus every label
 * name seen on the way (for the trusted-uploader rule). Empty when the
 * listing fails — a real answer, and the caller keeps the pick's
 * current link.
 */
export async function discogsArtistRecords(
  discogsIds: readonly number[],
  options: DiscogsReadOptions,
): Promise<{ records: DiscogsRecord[]; labels: string[] }> {
  const client = new DiscogsClient(options.deadline)
  const prefer = options.preferTitles ?? []
  const listed = (
    await Promise.all(
      discogsIds.slice(0, 2).map(async (id) => {
        const body = (await client.get(
          `/artists/${id}/releases?per_page=100&sort=year&sort_order=desc`,
        )) as Listing | null
        return (body?.releases ?? []).filter(
          (entry) => entry.role === 'Main' && entry.id && entry.title,
        )
      }),
    )
  ).flat()
  const listedLabels = [...new Set(listed.flatMap((entry) => (entry.label ? [entry.label] : [])))]
  // The pick's known title first; then MASTERS (an album or EP with its
  // pressings — where Discogs users attach the official videos), newest
  // first; plain releases (singles, splits, one-off pressings) last.
  // Newest-first alone let a run of recent singles and reissues use up
  // the reads before the albums carrying the videos (toe, Oct 2026).
  const preferred = (entry: (typeof listed)[number]) =>
    prefer.some((title) => sameTitle(title, entry.title ?? ''))
  const ordered = [
    ...listed.filter(preferred),
    ...listed.filter((entry) => !preferred(entry) && entry.type === 'master'),
    ...listed.filter((entry) => !preferred(entry) && entry.type !== 'master'),
  ].slice(0, options.maxRecords ?? MAX_RECORDS)

  const records: DiscogsRecord[] = []
  for (const entry of ordered) {
    if (options.enough?.(records)) break
    const path = entry.type === 'master' ? `/masters/${entry.id}` : `/releases/${entry.id}`
    const body = (await client.get(path)) as ApiRecord | null
    if (!body) continue
    const record = shapeRecord(body, listedLabels)
    if (record && record.videos.length > 0) records.push(record)
  }
  const labels = [...new Set([...listedLabels, ...records.flatMap((record) => record.labels ?? [])])]
  return { records, labels }
}
