/**
 * Render-time service pick for the ▶ badge (owner-approved Aug 30,
 * 2026). The resolver's streaming fallback ships every streaming page
 * it found (free services first) precisely so the fan's chosen listen
 * service can win HERE, on the client — the preference must never key
 * the shared 30-day play cache.
 *
 * The swap happens only INSIDE the streaming fallback: a verified
 * video, Bandcamp, SoundCloud or archive play is real music and is
 * never traded for an app-gated artist page. A fan whose service isn't
 * among the artist's pages keeps the default pick — free-first, per
 * the owner's ruling that paid streaming is a fallback, not a peer.
 */
import type { ListenService } from '../listen/services'
import { STREAMING_KINDS } from './types'
import type { ArtistPlay, PlayLink } from './types'

const SERVICE_KIND: Partial<Record<ListenService, PlayLink['kind']>> = {
  spotify: 'spotify',
  appleMusic: 'apple-music',
  amazonMusic: 'amazon-music',
  // 'youtube' maps to nothing: a fan preferring YouTube wants the
  // verified-video chain, which already ran and found none here.
}

export function pickPlayForService(
  result: ArtistPlay,
  service: ListenService,
): PlayLink | null {
  const { play, streaming } = result
  if (!play || !STREAMING_KINDS.has(play.kind)) return play
  const wanted = SERVICE_KIND[service]
  if (!wanted) return play
  return streaming?.find((link) => link.kind === wanted) ?? play
}
