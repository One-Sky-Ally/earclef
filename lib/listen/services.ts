/**
 * Fan-chosen listening service (v1 — links only, no APIs). The site
 * hosts no music: every listen click resolves to the fan's service
 * using per-artist data from the content JSONs; release-level links
 * are search URLs on that service (we hold no per-release IDs),
 * labeled as searches — "Search on X ↗", never a ▶ that promises
 * playback (owner rule, restated Oct 13 2026: music-service links are
 * fine when labeled honestly; only YouTube search links are banned).
 *
 * YouTube search URLs are BANNED (Aug 8, 2026 ruling): a YouTube miss
 * lands on unrelated video content, where a music-service miss lands
 * on an empty result page. Fans who chose YouTube get rerouted to an
 * Apple Music search at release level; artist-level YouTube stays
 * covered by the verified-play chain (lib/play).
 *
 * HONESTY RULE: a missing platform ID never implies absence — most
 * dormant Spotify IDs simply were never captured. "Not on X" is claimed
 * ONLY when the owner asserts it in the artist's listen.notOn, or when
 * scripts/verify-service-absence.mjs confirmed it against the service
 * itself (lib/listen/service-absence.json). A confirmed absence shows
 * a small note where the link would be — never a link, never a silent
 * reroute to another service.
 */
import type { ArtistContent } from '../types'
import { confirmedAbsences } from './serviceAbsence'

export type ListenService =
  | 'youtube'
  | 'spotify'
  | 'appleMusic'
  | 'amazonMusic'
  | 'deezer'
  | 'tidal'

export const SERVICE_ORDER: ListenService[] = [
  'youtube',
  'spotify',
  'appleMusic',
  'amazonMusic',
  'deezer',
  'tidal',
]

export const SERVICE_LABELS: Record<ListenService, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  amazonMusic: 'Amazon Music',
  deezer: 'Deezer',
  tidal: 'TIDAL',
}

export function isListenService(value: unknown): value is ListenService {
  return (
    typeof value === 'string' &&
    (SERVICE_ORDER as string[]).includes(value)
  )
}

/** Music services that release-level searches may target — no YouTube. */
export type MusicSearchService = Exclude<ListenService, 'youtube'>

export function isMusicSearchService(
  value: unknown,
): value is MusicSearchService {
  return isListenService(value) && value !== 'youtube'
}

/** Owner-asserted or verified absence from a service (never inferred). */
export interface ServiceAbsence {
  platform: MusicSearchService
  /** Owner-written line, e.g. "Not on Spotify — by her choice." */
  note?: string
  /** Where the claim comes from: the owner's file, or the verifier. */
  source?: 'owner' | 'verified'
}

/** What a listen surface needs to know about one artist. */
export interface ArtistServicePresence {
  artistName: string
  notOn?: ServiceAbsence[]
  /** Artist page on Apple Music (every roster artist has an iTunes id). */
  appleMusicUrl?: string
  /** Artist page on Spotify, when a dormant id exists. */
  spotifyUrl?: string
  /** Artist page on Amazon Music, when a verified link exists. */
  amazonMusicUrl?: string
  /** The artist's own storefront (Bandcamp) — where a note can still point. */
  bandcampUrl?: string
}

/** Everything the listen surfaces need, derived once per artist. */
export function presenceFromContent(
  content: ArtistContent,
): ArtistServicePresence {
  const appleMusicUrl =
    content.listen.platforms.find((p) => p.platform === 'appleMusic')?.url ??
    (content.integrations.itunes?.artistId
      ? `https://music.apple.com/us/artist/${content.integrations.itunes.artistId}`
      : undefined)
  const spotifyUrl = content.integrations.spotify.artistId
    ? `https://open.spotify.com/artist/${content.integrations.spotify.artistId}`
    : undefined
  const amazonMusicUrl = content.listen.platforms.find(
    (p) => p.platform === 'amazonMusic',
  )?.url
  const bandcampUrl = content.listen.platforms.find(
    (p) => p.platform === 'bandcamp',
  )?.url
  // The owner's word first; the verifier's confirmed absences fill in
  // the services the owner did not rule on.
  const owner: ServiceAbsence[] = (content.listen.notOn ?? [])
    .filter((absence) => isMusicSearchService(absence.platform))
    .map((absence) => ({ ...absence, source: 'owner' as const }))
  const ruled = new Set(owner.map((absence) => absence.platform))
  const verified = confirmedAbsences(content.slug).filter(
    (absence) => !ruled.has(absence.platform),
  )
  const notOn = [...owner, ...verified]
  return {
    artistName: content.hero.name,
    ...(notOn.length > 0 ? { notOn } : {}),
    appleMusicUrl,
    spotifyUrl,
    amazonMusicUrl,
    bandcampUrl,
  }
}

/** Honest action labels: these links search, they don't play. */
export const SEARCH_LABELS: Record<MusicSearchService, string> = {
  spotify: 'Search on Spotify',
  appleMusic: 'Search on Apple Music',
  amazonMusic: 'Search on Amazon Music',
  deezer: 'Search on Deezer',
  tidal: 'Search on TIDAL',
}

export function musicServiceSearchUrl(
  service: MusicSearchService,
  artistName: string,
  title?: string,
): string {
  const query = encodeURIComponent(
    title ? `${title} ${artistName}` : artistName,
  )
  switch (service) {
    case 'spotify':
      return `https://open.spotify.com/search/${query}`
    case 'amazonMusic':
      return `https://music.amazon.com/search/${query}`
    case 'deezer':
      return `https://www.deezer.com/search/${query}`
    case 'tidal':
      return `https://listen.tidal.com/search?q=${query}`
    default:
      return `https://music.apple.com/us/search?term=${query}`
  }
}

export function absenceFor(
  service: ListenService,
  presence: ArtistServicePresence | undefined,
): ServiceAbsence | undefined {
  return presence?.notOn?.find((absence) => absence.platform === service)
}

/** The small note shown where a link would be: "Not on Spotify". */
export function absenceNote(absence: ServiceAbsence): string {
  return absence.note ?? `Not on ${SERVICE_LABELS[absence.platform]}`
}

export type ResolvedListen =
  | {
      kind: 'search'
      href: string
      /** The service actually linked (Apple Music for YouTube fans). */
      service: MusicSearchService
      /** Honest action label for the link: "Search on X". */
      label: string
      rerouted: boolean
    }
  | {
      /** The artist is confirmed absent from the chosen service: a
       * note, not a link, and never a silent reroute elsewhere. */
      kind: 'absent'
      service: MusicSearchService
      note: string
      absence: ServiceAbsence
    }

/**
 * A release-level listen link for the chosen service. YouTube fans
 * reroute to Apple Music (YouTube search is banned); an artist
 * confirmed absent from the chosen service gets a note instead.
 */
export function resolveListenHref(
  service: ListenService,
  presence: ArtistServicePresence | undefined,
  artistName: string,
  title: string,
): ResolvedListen {
  const requested: MusicSearchService =
    service === 'youtube' ? 'appleMusic' : service
  const absence = absenceFor(requested, presence)
  if (absence) {
    return {
      kind: 'absent',
      service: requested,
      note: absenceNote(absence),
      absence,
    }
  }
  return {
    kind: 'search',
    href: musicServiceSearchUrl(requested, artistName, title),
    service: requested,
    label: SEARCH_LABELS[requested],
    rerouted: requested !== service,
  }
}
