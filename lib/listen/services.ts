/**
 * Fan-chosen listening service (v1 — links only, no APIs). Every listen
 * click resolves to the fan's service using per-artist data from the
 * content JSONs; release-level links are search URLs on that service
 * (we hold no per-release IDs), YouTube remains the default and final
 * fallback.
 *
 * HONESTY RULE: a missing platform ID never implies absence — most
 * dormant Spotify IDs simply were never captured. "Not on X" is claimed
 * ONLY when the owner asserts it in the artist's listen.notOn.
 */
import { listenSearch } from '../links'
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
  return {
    artistName: content.hero.name,
    notOn: content.listen.notOn,
    appleMusicUrl,
    spotifyUrl,
  }
}

export function serviceSearchUrl(
  service: ListenService,
  artistName: string,
  title: string,
): string {
  const query = encodeURIComponent(`${title} ${artistName}`)
  switch (service) {
    case 'spotify':
      return `https://open.spotify.com/search/${query}`
    case 'appleMusic':
      return `https://music.apple.com/us/search?term=${query}`
    case 'amazonMusic':
      return `https://music.amazon.com/search/${query}`
    default:
      return listenSearch(artistName, title)
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
  service: ListenService
  rerouted: boolean
}

/**
 * A release-level listen link for the chosen service. Artists asserted
 * absent from that service reroute — to Apple Music when we hold their
 * artist link there, otherwise to YouTube.
 */
export function resolveListenHref(
  service: ListenService,
  presence: ArtistServicePresence | undefined,
  artistName: string,
  title: string,
): ResolvedListen {
  if (service !== 'youtube' && absenceFor(service, presence)) {
    const fallback: ListenService =
      service !== 'appleMusic' && presence?.appleMusicUrl
        ? 'appleMusic'
        : 'youtube'
    return {
      href: serviceSearchUrl(fallback, artistName, title),
      service: fallback,
      rerouted: true,
    }
  }
  return {
    href: serviceSearchUrl(service, artistName, title),
    service,
    rerouted: false,
  }
}
