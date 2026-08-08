/**
 * Guards for listenHrefs STORED in durable data (the follow queue in
 * Blobs) — entries written before the verified-play policy hold
 * YouTube search URLs, and stored data outlives every code fix. Render
 * through these so a search URL can never reach the page again.
 */

const SEARCH_URL_PATTERN = /youtube\.com\/results\?|search_query=|\/search[/?]/

const READ_HOST_PATTERN =
  /musicbrainz\.org|wikipedia\.org|discogs\.com|wikidata\.org/

export function isSearchUrl(href: string): boolean {
  return SEARCH_URL_PATTERN.test(href)
}

/** A stored href safe to render: never a search URL, else the MB page. */
export function safeStoredHref(
  listenHref: string | undefined,
  mbid: string,
): string {
  return listenHref && !isSearchUrl(listenHref)
    ? listenHref
    : `https://musicbrainz.org/artist/${mbid}`
}

/**
 * Whether a safe href deserves a play affordance (▶) or is a
 * read-about page. Reference pages get 'about'; anything else that
 * survived the search-URL guard is an artist destination.
 */
export function storedHrefKind(href: string): 'play' | 'about' {
  return READ_HOST_PATTERN.test(href) ? 'about' : 'play'
}
