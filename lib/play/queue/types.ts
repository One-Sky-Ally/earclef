/**
 * Shapes shared by the queue resolver, its cache and the jobs that
 * maintain that cache. Relative imports only: bundled into Netlify
 * functions.
 */

export type TrackEraRating = 'in-era' | 'nearby' | 'catalog'

export interface QueueTrack {
  videoId: string
  title: string
  /**
   * Where the candidate came from:
   *   'channel' — an upload on the artist's channel (MB-linked, or one a
   *               verified find taught us; see learnedChannel.ts)
   *   'discogs' — a video Discogs lists on one of the artist's records
   *   'search'  — a YouTube search result
   * Every source passes the same artistMatch checks before it ships.
   */
  source: 'channel' | 'search' | 'discogs'
  /** How era-true the pick is: in-era | nearby (±15y) | catalog. */
  era: TrackEraRating
  /**
   * Search-sourced tracks written under the John Mayer rule (Aug 9,
   * 2026) or later. Pre-rule search entries lack this flag and are
   * treated as cache misses.
   */
  corroborated?: boolean
  /** The artist's work this upload was matched to. */
  eraTitle?: string
  /**
   * How it was proven the artist's (from Nov 19 2026) — for audits and
   * hand-checked samples. channel: the MB-linked channel, a learned one,
   * or an uploader named by the MB name / an alias / both scripts.
   * work: a release title, a song (recording) title, or a title only
   * Discogs credits to them.
   */
  how?: {
    channel: 'mb-link' | 'learned' | 'name' | 'alias' | 'both-scripts'
    work: 'release' | 'song' | 'discogs'
  }
}

export interface CachedResolve {
  at: string
  /** The artist's name as asked (from Nov 19 2026) — lets the sweep gate titles. */
  name?: string
  /** The era-truest pick — kept for readers that want just one. */
  track: QueueTrack | null
  /** Every playable song found, era-ranked; tracks[0] === track. */
  tracks?: QueueTrack[]
  /** Resolver gate version; absent = pre-gate (see GATE_PASS). */
  pass?: number
  /** PROMO_CHECK version the descriptions were read under. */
  promo?: number
  /** Era-dating corrections version (only checked for corrected artists). */
  cv?: string
  /**
   * Matching version (Nov 19 2026). Only nulls are re-resolved when it
   * moves: a found song stays found, but "nothing found" under older,
   * narrower matching is worth asking again.
   */
  mv?: number
  /**
   * When the stored YouTube facts (ids, titles) were last re-read from
   * the API. YouTube's Developer Policies (III.E.4) allow API data to be
   * kept for at most 30 days without a refresh. Absent = `at`.
   */
  checkedAt?: string
  /**
   * Free sources found nothing and a search was not allowed for this
   * request. A marker, not an answer: it lets the next free pass skip
   * MusicBrainz, and a request that may search resolves it properly.
   */
  needsSearch?: boolean
  /** A YouTube search was part of this resolve. */
  searched?: boolean
}
