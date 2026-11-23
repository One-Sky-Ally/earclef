/**
 * Release-level links that open the release itself on a listening
 * service, never a search (owner, Nov 23 2026: Björk's "The Björk Sides"
 * opened an Amazon Music search full of Moby and Michael Jackson). Every
 * link is CONFIRMED by one of three sources:
 *   - the artist's own Apple Music catalogue (iTunes lookup by their
 *     artist id),
 *   - their own Deezer catalogue (the Deezer artist pages MusicBrainz
 *     links to them),
 *   - a link MusicBrainz editors attached to the OFFICIAL release itself.
 * A service with no confirmed link keeps the labelled search.
 *
 * Pure, with RELATIVE imports only: the feed snapshot (a Netlify
 * background function) bundles this file.
 */
import type { MusicSearchService } from './services'

/** One confirmed link per service the release was found on. */
export type ReleaseLinks = Partial<Record<MusicSearchService, string>>

type Reader = (url: URL) => string | null

const AMAZON_HOST = /^music\.amazon\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br|com\.mx)$/

const READERS: ReadonlyArray<[MusicSearchService, Reader]> = [
  [
    'spotify',
    (url) => {
      if (url.hostname !== 'open.spotify.com') return null
      const id = url.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[a-z]+)?\/)?album\/([A-Za-z0-9]{22})\/?$/)?.[1]
      return id ? `https://open.spotify.com/album/${id}` : null
    },
  ],
  [
    'appleMusic',
    (url) => {
      if (url.hostname !== 'music.apple.com' && url.hostname !== 'itunes.apple.com') return null
      // ?i= points at one track inside the album: not the release.
      if (url.searchParams.has('i')) return null
      const match = url.pathname.match(/^\/([a-z]{2})\/album\/(?:[^/]+\/)?(?:id)?(\d+)\/?$/)
      return match ? `https://music.apple.com/${match[1]}/album/${match[2]}` : null
    },
  ],
  [
    'deezer',
    (url) => {
      if (url.hostname !== 'www.deezer.com' && url.hostname !== 'deezer.com') return null
      const id = url.pathname.match(/^\/(?:[a-z]{2}\/)?album\/(\d+)\/?$/)?.[1]
      return id ? `https://www.deezer.com/album/${id}` : null
    },
  ],
  [
    'tidal',
    (url) => {
      if (!['tidal.com', 'www.tidal.com', 'listen.tidal.com'].includes(url.hostname)) return null
      const id = url.pathname.match(/^\/(?:browse\/)?album\/(\d+)\/?$/)?.[1]
      return id ? `https://tidal.com/album/${id}` : null
    },
  ],
  [
    'amazonMusic',
    (url) => {
      if (!AMAZON_HOST.test(url.hostname) || url.searchParams.has('trackAsin')) return null
      const asin = url.pathname.match(/^\/albums\/([A-Z0-9]{10})\/?$/)?.[1]
      return asin ? `https://${url.hostname}/albums/${asin}` : null
    },
  ],
  [
    'youtubeMusic',
    (url) => {
      if (url.hostname !== 'music.youtube.com' || url.pathname !== '/playlist') return null
      // OLAK5uy_ lists are the album playlists YouTube Music builds from
      // official distribution — anyone's playlist (PL…) is not a release.
      const list = url.searchParams.get('list')
      return list && /^OLAK5uy_[\w-]+$/.test(list)
        ? `https://music.youtube.com/playlist?list=${list}`
        : null
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

/** The release-level service links among `urls`, first one per service. */
export function linksFromUrls(urls: readonly string[]): ReleaseLinks {
  return urls.reduce<ReleaseLinks>((links, raw) => {
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

/** An iTunes collectionViewUrl without its tracking query, or undefined. */
export function appleCollectionUrl(raw: string | undefined): string | undefined {
  const url = raw ? parse(raw) : null
  if (!url || (url.hostname !== 'music.apple.com' && url.hostname !== 'itunes.apple.com')) {
    return undefined
  }
  return `https://music.apple.com${url.pathname}`
}

/**
 * A release title compared across catalogues: accents and punctuation
 * dropped, Apple's " - Single" / " - EP" suffix too. Letters of any
 * script stay, so a Cyrillic title can still match itself.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+-\s+(single|ep)\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The same, blind to edition tags and feature credits ("(feat. …)", "(Deluxe …)"). */
function editionKey(title: string): string {
  return titleKey(
    title.replace(/[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special)\b[^)\]]*[)\]]/gi, ''),
  )
}

/**
 * Every item in a catalogue whose title IS this release's title: equal
 * keys first, then (only if none) equal edition-blind keys. Never a
 * partial match.
 */
export function matchesByTitle<T>(
  title: string,
  items: readonly T[],
  titleOf: (item: T) => string,
): T[] {
  for (const keyOf of [titleKey, editionKey]) {
    const key = keyOf(title)
    if (!key) continue
    const found = items.filter((item) => keyOf(titleOf(item)) === key)
    if (found.length > 0) return found
  }
  return []
}

/** The first of matchesByTitle, or undefined. */
export function matchByTitle<T>(
  title: string,
  items: readonly T[],
  titleOf: (item: T) => string,
): T | undefined {
  return matchesByTitle(title, items, titleOf)[0]
}

/** One MusicBrainz release as the release browse returns it (inc=url-rels). */
export interface MbReleaseWithLinks {
  status?: string | null
  date?: string
  /** XW = worldwide. */
  country?: string | null
  barcode?: string | null
  relations?: Array<{ type?: string; url?: { resource?: string } }>
}

/** What MusicBrainz says about one release group. */
export interface ReleaseCheck {
  /** At least one release is Official (not bootleg, promotion, withdrawn…). */
  official: boolean
  /** Service links attached to its official releases. */
  links: ReleaseLinks
  /**
   * An official release is documented as real: a service, a store, a
   * discography or Discogs page, or a barcode of its own (a product was
   * made — Bob Dylan's 2026 Rolling Thunder box has nothing else yet).
   */
  documented: boolean
  /** The earliest full date among its official releases. */
  date?: string
}

/**
 * Link types that point to where a release itself is, or to a page
 * listing it (MusicBrainz relationship names). "discography entry" covers
 * the label's or the artist's own discography and Record Store Day's
 * list (Khruangbin's and King Gizzard's 2026 RSD records).
 */
const WHERE_IT_LIVES = new Set([
  'streaming',
  'free streaming',
  'purchase for download',
  'purchase for mail-order',
  'download for free',
  'discogs',
  'discography entry',
])

/** A video of the music is not the release (DJ sets, remixes posted on YouTube). */
function isVideo(url: URL): boolean {
  return (
    url.hostname === 'youtu.be' ||
    ((url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com' || url.hostname === 'music.youtube.com') &&
      url.pathname === '/watch')
  )
}

/** Worldwide releases first, then the US, then the rest; earliest first within each. */
function storeOrder(release: MbReleaseWithLinks): string {
  const rank = release.country === 'XW' ? 0 : release.country === 'US' ? 1 : 2
  return `${rank}${release.date || '9999'}`
}

export function checkFromReleases(releases: readonly MbReleaseWithLinks[]): ReleaseCheck {
  // Each service's link comes from the first release that has one, in
  // store order, so editions do not mix at random.
  const official = releases
    .filter((release) => release.status === 'Official')
    .sort((a, b) => storeOrder(a).localeCompare(storeOrder(b)))
  const relations = official.flatMap((release) => release.relations ?? [])
  const urls = relations.flatMap((relation) => (relation.url?.resource ? [relation.url.resource] : []))
  const documented =
    official.some((release) => /^\d{8,14}$/.test(release.barcode ?? '')) ||
    relations.some((relation) => {
      const url = relation.url?.resource ? parse(relation.url.resource) : null
      return Boolean(url && relation.type && WHERE_IT_LIVES.has(relation.type) && !isVideo(url))
    })
  const date = official
    .map((release) => release.date ?? '')
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()[0]
  return {
    official: official.length > 0,
    links: linksFromUrls(urls),
    documented,
    ...(date ? { date } : {}),
  }
}
