/**
 * Discover's shapes: a verified pick, a set of picks, and the raw
 * candidate written during /refresh-earclef before verification.
 * Shared by the site (serving the stocked sets) and the local stocking
 * script (scripts/discover-stock.mjs). No I/O here.
 */
import type { ArtistLinks } from '../listen/artistLinks'
import type { PlayLink, ReadLink } from '../play/types'
import type { DiscoverSong } from './song'

export interface DiscoverPick {
  name: string
  why: string
  /**
   * A representative album or song. VERIFIED against the artist's
   * MusicBrainz release groups / recordings — a model may propose a
   * title, but an unverifiable one is replaced with the artist's real
   * top release (fabrications never reach the page; see the Butcher
   * Brown "Camp Culture" incident, Aug 2026).
   */
  knownFor: string
  /** True for freshly generated picks; false only for sanitized legacy pools. */
  knownForVerified: boolean
  mbid: string
  /** Verified play destination, or null (the card plays `song`, never this). */
  play: PlayLink | null
  read: ReadLink
  /** Back-compat mirror of play?.url ?? read.url. Never a search URL. */
  listenHref: string
  /**
   * A verified, playable YouTube song (Oct 11 2026; see ./song): the
   * card embeds it and keeps a small Bandcamp link beside it. null =
   * no verified song: never stocked, never shown (owner, Oct 15 2026).
   */
  song: DiscoverSong | null
  /**
   * More of the artist's own songs, best first (owner, Nov 28 2026:
   * "Keep listening to more music from that artist. It must be that
   * artist's music only"): each passed the same identity bar as `song`
   * (./song rankSongs), one video per song, never `song` again. Absent
   * until the refresh's enrich step has read the artist.
   */
  more?: DiscoverSong[]
  /**
   * The artist's own pages on music services, from MusicBrainz's url
   * relations (../listen/artistLinks) — the "Listen on" picker opens
   * these, else an honestly labelled search. Absent until enriched.
   */
  services?: ArtistLinks
  /** The artist's MB-linked Bandcamp page, whatever `play` picked. */
  bandcamp: string | null
  /**
   * Roster slugs (1–3) whose fans this pick is for — checked against the
   * roster, never matched by name. Listeners get the shared picks that
   * connect to artists in their rows (./match). Absent on older pools.
   */
  connectsTo?: string[]
}

/** A set of picks as served: the shared set of the day, or one of the owner's. */
export interface DiscoverPool {
  date: string
  picks: DiscoverPick[]
}

/** A candidate as written in-session, before any verification. */
export interface RawPick {
  name: string
  why: string
  knownFor: string
  connectsTo: string[]
}

/**
 * Picks per stocked set (owner, Oct 15 2026): visitors see one shared
 * set of 12 a day; the owner's own sets are 8 each.
 */
export const SET_SIZES = { shared: 12, owner: 8 } as const
export const VISITOR_PICKS = SET_SIZES.shared

export type StockKind = keyof typeof SET_SIZES

/** Songs kept beyond the pick's own: "more from this artist" plays up to 10 in all. */
export const MAX_MORE_SONGS = 9
