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

export interface PlayLink {
  kind: PlayKind
  url: string
}

export type ReadKind = 'wikipedia' | 'musicbrainz' | 'discogs' | 'wikidata'

export interface ReadLink {
  kind: ReadKind
  url: string
}

/** What a play surface renders from: one of these is always present. */
export interface ArtistPlay {
  play: PlayLink | null
  read: ReadLink | null
}

export const PLAY_LABELS: Record<PlayKind, string> = {
  'youtube-video': 'Watch on YouTube',
  'youtube-channel': "Artist's YouTube channel",
  bandcamp: 'Listen on Bandcamp',
  soundcloud: 'Listen on SoundCloud',
  archive: 'Listen on Internet Archive',
  official: "Artist's official site",
}
