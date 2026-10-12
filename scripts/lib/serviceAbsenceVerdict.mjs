/**
 * The rules behind "Not on Spotify": pure, so they can be tested
 * without a network. The verifier (scripts/verify-service-absence.mjs)
 * gathers LEGS of evidence per artist and service and asks
 * `decideVerdict` for the word the site may show.
 *
 * Owner rule (Oct 13 2026): a note shows only when the absence is
 * CONFIRMED; a missing link in our data is not proof. So:
 *   present — ANY leg found the artist on the service (a link or id in
 *             the content file, a MusicBrainz URL relation, or the
 *             service's own artist search returning that exact name).
 *   absent  — the service search RAN and found no artist of that name,
 *             AND the MusicBrainz record was read and carries no link
 *             to the service (or the artist has no MusicBrainz record
 *             to read), AND the content file holds nothing for it.
 *   unknown — anything less (no credentials, a failed call, a service
 *             with no public search such as Amazon Music). Unknown
 *             never shows a note.
 */
import { sameName } from './normalizeName.mjs'

/** Hosts whose URL relations prove a presence on a service. */
export const SERVICE_HOSTS = {
  spotify: ['open.spotify.com'],
  appleMusic: ['music.apple.com', 'itunes.apple.com'],
  amazonMusic: ['music.amazon.com', 'music.amazon.co.uk', 'music.amazon.de', 'music.amazon.fr', 'music.amazon.co.jp', 'music.amazon.ca', 'amazon.com'],
  deezer: ['deezer.com', 'www.deezer.com'],
  tidal: ['tidal.com', 'listen.tidal.com', 'www.tidal.com'],
}

export const SERVICES = Object.keys(SERVICE_HOSTS)

export function hostMatchesService(url, service) {
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  const hosts = SERVICE_HOSTS[service] ?? []
  // amazon.com alone proves nothing (a store page is not Amazon Music):
  // the generic host counts only on a /music path.
  if (service === 'amazonMusic' && host.endsWith('amazon.com') && !host.startsWith('music.')) {
    try {
      return new URL(url).pathname.startsWith('/music')
    } catch {
      return false
    }
  }
  return hosts.some((known) => host === known || host.endsWith(`.${known}`))
}

/** True when any search hit names the artist exactly (normalized). */
export function searchNamesArtist(hitNames, artistName) {
  return hitNames.some((hit) => sameName(hit, artistName))
}

/**
 * @param legs {{
 *   content: 'present' | 'absent',
 *   musicbrainz: 'present' | 'absent' | 'no-record' | 'failed',
 *   search: 'present' | 'absent' | 'unavailable' | 'failed',
 * }}
 */
export function decideVerdict(legs) {
  if (legs.content === 'present' || legs.musicbrainz === 'present' || legs.search === 'present') {
    return 'present'
  }
  const mbClear = legs.musicbrainz === 'absent' || legs.musicbrainz === 'no-record'
  if (legs.search === 'absent' && mbClear && legs.content === 'absent') {
    return 'absent'
  }
  return 'unknown'
}

/** One line of evidence a reader can check later. */
export function describeLegs(legs, extra = {}) {
  const parts = [
    `content: ${legs.content}`,
    `musicbrainz: ${legs.musicbrainz}`,
    `search: ${legs.search}${extra.searchDetail ? ` (${extra.searchDetail})` : ''}`,
  ]
  return parts.join(' · ')
}
