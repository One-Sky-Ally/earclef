/**
 * Liked songs — the shape, and the only gate anything enters it through.
 *
 * A like saves the track AS THE QUEUE VERIFIED IT: the video id it was
 * playing (playability-checked by the resolver chain before it ever
 * reached a listener), its title and artist, the artist's genre tags,
 * and the place+era the queue was walking. Frozen at like time on
 * purpose — the pools churn, and a saved song must not lose the labels
 * its own filters are built on.
 *
 * Pure and dependency-free so the client can hold the same shape in
 * localStorage before anyone signs in, and hand it over unchanged on
 * the merge.
 */

export interface LikedTrack {
  /**
   * YouTube id — the identity key. Verified playable at like time; the
   * like still replays a real destination rather than a search URL.
   */
  videoId: string
  title: string
  artistName: string
  /**
   * MusicBrainz artist id, when the queue knew one. Pre-resolved #1-hits
   * entries carry no MBID, and a bare name is not an identity — so those
   * likes save the song and can never put an artist on the radar.
   */
  mbid?: string
  /** The artist's canonical genres, as the queue carried them. */
  genres?: string[]
  /** ISO code of the place the queue was playing, when there was one. */
  placeCode?: string
  placeName?: string
  year?: number
  /** ISO datetime — orders the playlist, survives the local→server merge. */
  likedAt: string
}

/** A sitting's worth of saving, with room to spare — never a silent drop. */
export const MAX_LIKES = 500
const MAX_GENRES = 12
const MAX_TITLE = 200
const MAX_NAME = 200
const MAX_PLACE_NAME = 100
const MAX_GENRE = 60
const YEAR_FLOOR = 1900

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PLACE_CODE_PATTERN = /^[A-Za-z-]{2,12}$/

/** Strips control characters and trims — display strings, not keys. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
}

export function isVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value)
}

/**
 * Two likes are the same song only when BOTH carry a video id. Missing
 * is not a match — an absent id on either side must never dedupe two
 * different songs into one (standing lesson: absent values never
 * satisfy an identity comparison).
 */
export function sameTrack(a: LikedTrack, b: LikedTrack): boolean {
  return isVideoId(a.videoId) && isVideoId(b.videoId) && a.videoId === b.videoId
}

function cleanGenres(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const genres = [
    ...new Set(
      raw.map((genre) => clean(genre, MAX_GENRE)).filter((genre) => genre),
    ),
  ].slice(0, MAX_GENRES)
  return genres.length > 0 ? genres : undefined
}

/**
 * A client-supplied timestamp is kept — it preserves the order of likes
 * made before sign-in — but never trusted past now: a skewed clock must
 * not pin a track to the top of the playlist forever.
 */
function cleanLikedAt(raw: unknown, now: number): string {
  const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
  if (Number.isNaN(parsed) || parsed > now) return new Date(now).toISOString()
  return new Date(parsed).toISOString()
}

/**
 * The gate. Returns a like only when it has a verified-shaped video id
 * and something to show for it; every optional field is dropped rather
 * than stored malformed. Never throws — bad input is simply not a like.
 */
export function sanitizeLikedTrack(
  raw: unknown,
  now = Date.now(),
): LikedTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>

  const videoId = typeof input.videoId === 'string' ? input.videoId : ''
  if (!isVideoId(videoId)) return null

  const title = clean(input.title, MAX_TITLE)
  const artistName = clean(input.artistName, MAX_NAME)
  if (!title || !artistName) return null

  const mbid = clean(input.mbid, 36).toLowerCase()
  const placeCode = clean(input.placeCode, 12)
  const placeName = clean(input.placeName, MAX_PLACE_NAME)
  const year =
    typeof input.year === 'number' && Number.isInteger(input.year)
      ? input.year
      : undefined
  const genres = cleanGenres(input.genres)

  return {
    videoId,
    title,
    artistName,
    ...(MBID_PATTERN.test(mbid) && { mbid }),
    ...(genres && { genres }),
    ...(PLACE_CODE_PATTERN.test(placeCode) && { placeCode }),
    ...(placeName && { placeName }),
    ...(year !== undefined &&
      year >= YEAR_FLOOR &&
      year <= new Date(now).getUTCFullYear() + 1 && { year }),
    likedAt: cleanLikedAt(input.likedAt, now),
  }
}

/** Newest first — the playlist's only ordering. */
export function byNewestFirst(a: LikedTrack, b: LikedTrack): number {
  return b.likedAt.localeCompare(a.likedAt)
}
