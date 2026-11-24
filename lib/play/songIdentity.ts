/**
 * The "On this day" identity bar (scripts/lib/onThisDayPlay.mjs, owner-
 * ratified Oct 10 2026), made record-agnostic for Discover picks: a pick
 * has no one release on the page, so EVERY Discogs record the artist's
 * own id is credited on is a source. The bar itself is unchanged:
 *   · ANCHOR by id: the artist's Discogs id (MusicBrainz's own url
 *     relation, never a name) is the record's whole credit, or is
 *     credited on the very track the video matches; Various never; a
 *     track with its own credit must include the artist, whole credit
 *     or not (a DJ mix's tracks are other artists' songs);
 *   · CORROBORATION: the video's title equals a track's or the record's
 *     (whole units, no fuzzy matching), or — on a whole credit, where
 *     the caller allows it (not Discover: see IdentityOptions) — its
 *     length is within ±3 s of exactly one track.
 *
 * Pure: the caller feeds records (Discogs API at runtime, the local dump
 * in scripts) and checks playability with YouTube afterwards.
 */
import { colonDurationSeconds, titleVariants, variantsIntersect } from './titleVariants'

/** Discogs's "Various" pseudo-artist — never an identity. */
export const DISCOGS_VARIOUS_ID = 194
const DURATION_TOLERANCE_S = 3

export interface DiscogsTrack {
  title: string
  duration?: string | null
  /** Per-track credit ids (shared records); empty on a whole-credit record. */
  artists?: number[]
}

export interface DiscogsVideo {
  videoId: string
  title: string
  /** Seconds, as Discogs stores it; null when unknown. */
  duration?: number | null
}

export interface DiscogsRecord {
  id: number
  title: string
  year: number | null
  /** Main credit ids. */
  artists: number[]
  tracklist: DiscogsTrack[]
  videos: DiscogsVideo[]
  labels?: string[]
  /** A master's main pressing: masters carry no label names, their pressings do. */
  mainRelease?: number | null
}

export interface SongCandidate {
  videoId: string
  uploadTitle: string
  /** The song as the catalog names it (the matched track or record title). */
  songTitle: string
  release: string
  anchor: 'whole' | 'track'
  leg: 'title' | 'duration'
}

interface Match {
  track: DiscogsTrack | null
  order: number
  leg: SongCandidate['leg']
}

export interface IdentityOptions {
  /**
   * The length leg: an untitled match by duration. Off for Discover
   * (owner, Nov 24 2026: "A pick should only play a real song, shown
   * under its real title" — The Mike Flowers Pops' "Don't Cry For My
   * Argentina" video ran the length of their B-side "I Dreamt I Was
   * Dreaming" and would have been labelled with it). Length can tell
   * WHOSE record a video belongs to; it cannot say which song it is.
   */
  byLength?: boolean
}

function matchVideo(
  video: DiscogsVideo,
  record: DiscogsRecord,
  whole: boolean,
  aliases: ReadonlySet<string>,
  byLength: boolean,
): Match | null {
  const upload = titleVariants(video.title, aliases)
  const byTitle = record.tracklist.findIndex((row) =>
    variantsIntersect(upload, titleVariants(row.title, aliases)),
  )
  if (byTitle !== -1) return { track: record.tracklist[byTitle], order: byTitle, leg: 'title' }
  if (variantsIntersect(upload, titleVariants(record.title, aliases))) {
    return { track: null, order: -1, leg: 'title' }
  }
  if (!byLength || !whole || !video.duration) return null
  const timed = record.tracklist
    .map((row, order) => ({ row, order, seconds: colonDurationSeconds(row.duration) }))
    .filter(
      (entry) =>
        entry.seconds !== null && Math.abs(entry.seconds - (video.duration ?? 0)) <= DURATION_TOLERANCE_S,
    )
  return timed.length === 1 ? { track: timed[0].row, order: timed[0].order, leg: 'duration' } : null
}

function recordCandidates(
  record: DiscogsRecord,
  artistIds: ReadonlySet<number>,
  aliases: ReadonlySet<string>,
  byLength: boolean,
): SongCandidate[] {
  const credit = record.artists
  if (credit.length === 0 || credit.includes(DISCOGS_VARIOUS_ID)) return []
  const whole = credit.every((id) => artistIds.has(id))
  const recordKey = titleVariants(record.title, aliases)
  const ranked = record.videos.flatMap((video) => {
    if (!video.videoId) return []
    const match = matchVideo(video, record, whole, aliases, byLength)
    if (!match) return []
    const trackCredit = match.track?.artists ?? []
    const onTrack = trackCredit.some((id) => artistIds.has(id))
    if (!whole && !onTrack) return []
    // A track credited to others is theirs, even on a record credited to
    // this artist — a DJ mix or a tribute album (Nov 24, 2026: DJ Cheb i
    // Sabbah's "As Far As - A DJ Mix" offered Sekouba Bambino's "Sinikan").
    if (trackCredit.length > 0 && !onTrack) return []
    const songTitle = match.track?.title ?? record.title
    const isTitleSong = variantsIntersect(titleVariants(songTitle, aliases), recordKey)
    return [
      {
        candidate: {
          videoId: video.videoId,
          uploadTitle: video.title,
          songTitle,
          release: record.title,
          anchor: whole ? ('whole' as const) : ('track' as const),
          leg: match.leg,
        },
        rank: isTitleSong ? -1 : match.order,
      },
    ]
  })
  // Stable: the record's own title song leads, then its tracks in order.
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.candidate)
}

/**
 * Every verified video across the artist's records, records in the
 * order given (the caller decides — newest first for Discover), each
 * video offered once.
 */
export function recordSongCandidates(
  records: readonly DiscogsRecord[],
  artistIds: ReadonlySet<number>,
  aliases: ReadonlySet<string>,
  options: IdentityOptions = {},
): SongCandidate[] {
  const seen = new Set<string>()
  const byLength = options.byLength ?? true
  return records.flatMap((record) =>
    recordCandidates(record, artistIds, aliases, byLength).filter((candidate) => {
      if (seen.has(candidate.videoId)) return false
      seen.add(candidate.videoId)
      return true
    }),
  )
}
