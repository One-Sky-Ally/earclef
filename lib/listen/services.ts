/**
 * Fan-chosen listening service (v1 — links only, no APIs). Every listen
 * click resolves to the fan's service using per-artist data from the
 * content JSONs; release-level links are search URLs on that service
 * (we hold no per-release IDs), labeled as searches — "Search on X",
 * never a ▶ that promises playback.
 *
 * YouTube search URLs are BANNED (Aug 8, 2026 ruling): a YouTube miss
 * lands on unrelated video content, where a music-service miss lands
 * on an empty result page. Fans who chose YouTube get rerouted to an
 * Apple Music search at release level; artist-level YouTube stays
 * covered by the verified-play chain (lib/play).
 *
 * HONESTY RULE: a missing platform ID never implies absence — most
 * dormant Spotify IDs simply were never captured. "Not on X" is claimed
 * ONLY when the owner asserts it in the artist's listen.notOn.
 */
import type { ArtistContent } from '../types'

export type ListenService = 'youtube' | 'spotify' | 'appleMusic' | 'amazonMusic'

export const SERVICE_ORDER: ListenService[] = [
  'youtube',
  'spotify',
  'appleMusic',
  'amazonMusic',
]

export const SERVICE_LABELS: Record<ListenService, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  amazonMusic: 'Amazon Music',
}

export function isListenService(value: unknown): value is ListenService {
  return (
    typeof value === 'string' &&
    (SERVICE_ORDER as string[]).includes(value)
  )
}

/** Owner-asserted absence from a service (never inferred from data). */
export interface ServiceAbsence {
  platform: Exclude<ListenService, 'youtube'>
  /** Owner-written line, e.g. "Not on Spotify — by her choice." */
  note?: string
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
  return {
    artistName: content.hero.name,
    notOn: content.listen.notOn,
    appleMusicUrl,
    spotifyUrl,
    amazonMusicUrl,
  }
}

/** Music services that release-level searches may target — no YouTube. */
export type MusicSearchService = Exclude<ListenService, 'youtube'>

/** Honest action labels: these links search, they don't play. */
export const SEARCH_LABELS: Record<MusicSearchService, string> = {
  spotify: 'Search on Spotify',
  appleMusic: 'Search on Apple Music',
  amazonMusic: 'Search on Amazon Music',
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

export interface ResolvedListen {
  href: string
  /** The service actually linked (differs when rerouted around an absence). */
  service: MusicSearchService
  /** Honest action label for the link: "Search on X". */
  label: string
  rerouted: boolean
}

/**
 * A release-level listen link for the chosen service. YouTube fans
 * reroute to Apple Music (YouTube search is banned); artists asserted
 * absent from the target reroute to the first service the owner has
 * not marked them absent from.
 */
export function resolveListenHref(
  service: ListenService,
  presence: ArtistServicePresence | undefined,
  artistName: string,
  title: string,
): ResolvedListen {
  const requested: MusicSearchService =
    service === 'youtube' ? 'appleMusic' : service
  const order: MusicSearchService[] = [
    requested,
    'appleMusic',
    'amazonMusic',
    'spotify',
  ]
  const resolved =
    order.find((candidate) => !absenceFor(candidate, presence)) ?? requested
  return {
    href: musicServiceSearchUrl(resolved, artistName, title),
    service: resolved,
    label: SEARCH_LABELS[resolved],
    rerouted: resolved !== service,
  }
}
