/**
 * Committed verified-play results for gap-fill artists, produced by
 * scripts/build-extra-play.mjs (local sweep: Discogs release videos +
 * YouTube playability + Internet Archive exact-alias). Keys match
 * extraPlayKey() in ./extraArtists.
 *
 * A key that is PRESENT with play:null was swept and verified to have
 * nothing — the sweep's verdict (made with the full alias set,
 * Wikidata labels included) is authoritative; rechecking at runtime
 * with less data would only re-miss. Absent keys were never swept
 * (future gap-fill countries) and may resolve live.
 *
 * THIRD STATE (owner-ruled, Aug 30 2026): `identityUnverified` marks a
 * youtube-video verdict QUARANTINED — the original sweep bound videos
 * by release-attachment alone, and the enrichment pass showed that
 * frequently names the wrong artist (T.O. Jazz → a Leipzig choir
 * carol). Quarantined entries answer like never-swept: the live chain
 * (Internet Archive exact-alias) may still verify honestly, but the
 * stored link never serves. The URL is preserved for the repair pass.
 */
import type { PlayLink } from '../play/types'
import extraPlay from './extra-play.json'

interface ExtraPlayEntry {
  play: PlayLink | null
  /** Discogs artist id recovered by the sweep for an id-less credit. */
  resolvedArtistId?: number | string
  /** Upload title, from scripts/enrich-extra-play.mjs. */
  title?: string
  durationSeconds?: number
  /**
   * false = verified present but barred from place+era QUEUES: under
   * the song-length floor (an intro, a teaser, a promo clip), gone from
   * YouTube, or no longer embeddable. The pill still offers the link —
   * what a pill may show is a separate owner ruling from what may be
   * auto-played in sequence.
   */
  queueEligible?: boolean
  /** Absent from videos.list at enrichment time: deleted or blocked. */
  gone?: boolean
  /**
   * Quarantined (Aug 30, 2026): the committed video carries no identity
   * evidence — see the module header. Never served; kept for repair.
   */
  identityUnverified?: boolean
}

/** A gap-fill entry ready to play in a queue with no resolver walk. */
export interface ExtraQueueTrack {
  videoId: string
  title: string
}

const DATASET = extraPlay as unknown as {
  generatedAt: string | null
  entries: Record<string, ExtraPlayEntry>
}

/**
 * undefined = never swept OR quarantined (both mean: no committed
 * verdict to serve — the caller's live chain decides); null = swept,
 * nothing verified.
 */
export function committedExtraPlay(key: string): PlayLink | null | undefined {
  const entry = DATASET.entries[key]
  if (entry === undefined || entry.identityUnverified) return undefined
  return entry.play
}

export function recoveredDiscogsId(key: string): number | string | null {
  return DATASET.entries[key]?.resolvedArtistId ?? null
}

function videoIdOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return parsed.pathname.slice(1) || null
    if (host === 'youtube.com') return parsed.searchParams.get('v')
    return null
  } catch {
    return null
  }
}

/**
 * The queue view of a gap-fill entry: a video the place+era queue can
 * play directly, no resolver walk (these were verified by the local
 * sweep, and title + duration by the enrichment pass).
 *
 * Every condition must be affirmatively met — an unenriched entry has
 * no title and no duration, and missing is not a match (standing lesson
 * 5), so it is not offered to a queue. Internet Archive plays are
 * excluded too: the queue runs a YouTube iframe player.
 */
export function extraQueueTrack(key: string): ExtraQueueTrack | null {
  const entry = DATASET.entries[key]
  if (!entry || entry.play?.kind !== 'youtube-video') return null
  if (entry.identityUnverified || entry.queueEligible === false) return null
  if (!entry.title) return null
  const videoId = videoIdOf(entry.play.url)
  return videoId ? { videoId, title: entry.title } : null
}
