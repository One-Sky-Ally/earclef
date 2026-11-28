/**
 * An artist's own page on each music service, read from the url
 * relations MusicBrainz keeps for them — evidence, never a name search.
 * Discover picks carry these for the "Listen on" picker (owner, Nov 28
 * 2026: "Open the artist on my chosen service with the same 'Listen on'
 * picker the artist page has"). A service with no page here gets an
 * honestly labelled search instead (./services musicServiceSearchUrl).
 */
import type { MusicSearchService } from './services'

export type ArtistLinks = Partial<Record<MusicSearchService, string>>

type Reader = (url: URL) => string | null

const READERS: [MusicSearchService, Reader][] = [
  [
    'spotify',
    (url) => {
      const id = url.hostname === 'open.spotify.com' ? url.pathname.match(/^\/artist\/([A-Za-z0-9]+)\/?$/)?.[1] : null
      return id ? `https://open.spotify.com/artist/${id}` : null
    },
  ],
  [
    'appleMusic',
    (url) => {
      if (url.hostname !== 'music.apple.com') return null
      const path = url.pathname.match(/^\/[a-z]{2}\/artist\/(?:[^/]+\/)?\d+\/?$/)?.[0]
      return path ? `https://music.apple.com${path.replace(/\/$/, '')}` : null
    },
  ],
  [
    'amazonMusic',
    (url) => {
      // Amazon's own music domains only — MusicBrainz links are community-edited.
      if (!/^music\.amazon\.(?:com|co\.uk|de|fr|it|es|co\.jp|ca|com\.au|com\.br|com\.mx|in|nl|se|pl)$/.test(url.hostname)) return null
      const asin = url.pathname.match(/^\/artists\/([A-Z0-9]{10})(?:\/|$)/)?.[1]
      return asin ? `https://${url.hostname}/artists/${asin}` : null
    },
  ],
  [
    'deezer',
    (url) => {
      if (!/^(www\.)?deezer\.com$/.test(url.hostname)) return null
      const id = url.pathname.match(/^\/(?:[a-z]{2}\/)?artist\/(\d+)\/?$/)?.[1]
      return id ? `https://www.deezer.com/artist/${id}` : null
    },
  ],
  [
    'tidal',
    (url) => {
      if (!/^(listen\.|www\.)?tidal\.com$/.test(url.hostname)) return null
      const id = url.pathname.match(/^\/(?:browse\/)?artist\/(\d+)\/?$/)?.[1]
      return id ? `https://tidal.com/browse/artist/${id}` : null
    },
  ],
  [
    'youtubeMusic',
    (url) => {
      const channel =
        url.hostname === 'music.youtube.com' ? url.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/)?.[1] : null
      return channel ? `https://music.youtube.com/channel/${channel}` : null
    },
  ],
]

function parse(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** The artist pages among `urls`, the first one per service. */
export function artistLinksFromUrls(urls: readonly string[]): ArtistLinks {
  return urls.reduce<ArtistLinks>((links, raw) => {
    const url = parse(raw)
    if (!url) return links
    for (const [service, read] of READERS) {
      if (links[service]) continue
      const link = read(url)
      if (link) return { ...links, [service]: link }
    }
    return links
  }, {})
}

/** The same, from MusicBrainz url relations. */
export function artistLinksFromRelations(
  relations: readonly { url?: { resource?: string } }[] | undefined,
): ArtistLinks {
  return artistLinksFromUrls((relations ?? []).flatMap((relation) => relation.url?.resource ?? []))
}

/** Stored links, checked again before use: only https artist pages survive. */
export function sanitizeArtistLinks(raw: unknown): ArtistLinks {
  if (!raw || typeof raw !== 'object') return {}
  const entries = Object.values(raw as Record<string, unknown>).filter((value): value is string => typeof value === 'string')
  return artistLinksFromUrls(entries)
}
