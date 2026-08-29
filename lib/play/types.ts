/**
 * Verified play destinations. POLICY (Aug 2026): a play affordance may
 * only point at a verified, artist-specific destination — a playability-
 * checked YouTube video, an artist's own MusicBrainz-linked page
 * (Bandcamp / SoundCloud / YouTube channel / official site), or an
 * Internet Archive item whose creator matches. Never a search URL: a
 * search that lands on garbage is fake-full, and the site is
 * honest-sparse. No verified destination → no play button.
 */

export type PlayKind =
  | 'youtube-video'
  | 'youtube-channel'
  | 'bandcamp'
  | 'soundcloud'
  | 'archive'
  | 'official'
  /** Owner-curated video from an allowlisted archive (lib/play/archival.ts). */
  | 'archival-video'
  /**
   * Platform-hosted streaming pages (owner-approved Aug 30, 2026):
   * MB-attached artist pages on the big services. LAST in the chain —
   * they open an app-gated page, where everything above plays free and
   * direct. Platform hosts cannot be domain-squatted, so the Aug-29
   * phishing class structurally cannot recur here.
   */
  | 'spotify'
  | 'deezer'
  | 'apple-music'
  | 'tidal'
  | 'amazon-music'

export interface PlayLink {
  kind: PlayKind
  url: string
}

/**
 * Streaming kinds with a free ad-supported tier — a fact about the
 * services themselves, not about MB's relation typing (which varies).
 * Owner ruling: free streaming first; paid earns a ▶ only when no free
 * option exists for that artist.
 */
export const FREE_STREAMING_KINDS: ReadonlySet<PlayKind> = new Set([
  'spotify',
  'deezer',
])

export const STREAMING_KINDS: ReadonlySet<PlayKind> = new Set([
  'spotify',
  'deezer',
  'apple-music',
  'tidal',
  'amazon-music',
])

export type ReadKind = 'wikipedia' | 'musicbrainz' | 'discogs' | 'wikidata'

export interface ReadLink {
  kind: ReadKind
  url: string
}

/** What a play surface renders from: one of these is always present. */
export interface ArtistPlay {
  play: PlayLink | null
  read: ReadLink | null
  /**
   * Present ONLY when `play` is a streaming kind: every streaming page
   * found on the artist, free services first. The client swaps in the
   * fan's chosen service when it's in this list — the preference lives
   * client-side so the 30-day play cache stays shared, never keyed by
   * service. A verified video/Bandcamp/archive `play` is never
   * downgraded to a streaming page, so no list ships alongside those.
   */
  streaming?: PlayLink[]
}

export const PLAY_LABELS: Record<PlayKind, string> = {
  'youtube-video': 'Watch on YouTube',
  'youtube-channel': "Artist's YouTube channel",
  bandcamp: 'Listen on Bandcamp',
  soundcloud: 'Listen on SoundCloud',
  archive: 'Listen on Internet Archive',
  official: "Artist's official site",
  'archival-video': 'Watch on YouTube — vetted archive',
  spotify: 'Listen on Spotify',
  deezer: 'Listen on Deezer',
  'apple-music': 'Listen on Apple Music',
  tidal: 'Listen on Tidal',
  'amazon-music': 'Listen on Amazon Music',
}
