/**
 * setlist.fm links for an artist's full show history. The EXACT page is
 * the one MusicBrainz lists for the artist's MBID (its "setlistfm" URL
 * relation) — identified by id, never by name. Without exactly one such
 * page the link is a search, and says so (owner, Oct 14 2026).
 */

interface MbUrlRelation {
  type?: string
  url?: { resource?: string }
}

/** setlist.fm artist pages: /setlists/<name>-<hex id>.html */
const ARTIST_PAGE = /^\/setlists\/[a-z0-9][a-z0-9-]*-[0-9a-f]+\.html$/i

/** The one setlist.fm artist page MusicBrainz links, normalised — or null. */
export function setlistFmArtistUrl(relations: readonly MbUrlRelation[]): string | null {
  const found = new Set<string>()
  for (const relation of relations) {
    const resource = relation.url?.resource
    if (!resource) continue
    let url: URL
    try {
      url = new URL(resource)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== 'setlist.fm' || !/^https?:$/.test(url.protocol)) continue
    if (!ARTIST_PAGE.test(url.pathname)) continue
    found.add(`https://www.setlist.fm${url.pathname.toLowerCase()}`)
  }
  // Two different pages is not an identity — fall back to the search.
  return found.size === 1 ? [...found][0] : null
}

export function setlistFmSearchUrl(artistName: string): string {
  return `https://www.setlist.fm/search?query=${encodeURIComponent(artistName)}`
}
