/**
 * Who uploaded it, and which of the artist's works it is: the two facts
 * every queue song is accepted on.
 *
 * THE PRINCIPLE (owner, Nov 19 2026): it must be the right artist's
 * music, and how that is proven is ours to choose, with a hand-checked
 * sample. These rules replace exact-name-only channel matching, the
 * two-alias-type limit and the one-song limit on search. They were
 * chosen against samples, not invented:
 *
 *   CHANNEL — the uploader is named for the artist: the MusicBrainz name,
 *   any MB alias except "Search hint" (those are misspellings kept for
 *   search), or the name and an alias together in either order. That last
 *   form is how YouTube names many non-Latin artists' channels, e.g.
 *   "엄정화 Uhm Jung Hwa". Auto-generated " - Topic" channels and the
 *   official suffixes (VEVO, Official, Music) count; spacing and
 *   punctuation do not ("ACDC" is AC/DC).
 *
 *   WORK — the upload's title names one of the artist's OWN works (a
 *   release-group or recording title from their MusicBrainz catalogue, or
 *   a title Discogs credits to them). A Latin-script title must match on
 *   word boundaries ("Love" is not in "Lovely Day"). Scripts written
 *   without spaces match by containment. Titles too short to identify
 *   anything are ignored. When several works fit, the longest wins:
 *   "Esclavos del destino" over "Destino".
 *
 * Standing lesson 5 holds throughout: an empty name or title matches
 * nothing.
 *
 * Relative imports only: bundled into Netlify functions.
 */

export type WorkEra = 'in-era' | 'nearby' | 'catalog'

export interface Work {
  title: string
  era: WorkEra
}

export interface ArtistAlias {
  name: string
  type?: string | null
}

/** The comparison form: lower case, accents off, punctuation → space. */
export function matchKey(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const compact = (key: string) => key.replace(/ /g, '')

/** Every channel name that counts as this artist, in matchKey form. */
export function channelNamesFor(name: string, aliases: ArtistAlias[]): Set<string> {
  const own = matchKey(name)
  const aliasKeys = aliases
    .filter((alias) => alias.type !== 'Search hint')
    .map((alias) => matchKey(alias.name))
    .filter((key) => key && key !== own)
  const combined = own ? aliasKeys.flatMap((key) => [`${own} ${key}`, `${key} ${own}`]) : []
  return new Set([own, ...aliasKeys, ...combined].filter(Boolean))
}

const TOPIC = /\s*-\s*topic$/i
const COMPACT_SUFFIX = /vevo$/
const SPACED_SUFFIX = / (official|oficial|officiel|music|vevo)$/

/** Is this channel title one of the artist's names? */
export function channelMatchesArtist(channelTitle: string, names: Set<string>): boolean {
  const key = matchKey((channelTitle ?? '').replace(TOPIC, ''))
  if (!key || names.size === 0) return false
  const forms = new Set([key, key.replace(SPACED_SUFFIX, ''), key.replace(COMPACT_SUFFIX, '').trim()])
  const compactNames = new Set([...names].map(compact))
  return [...forms].some((form) => form && (names.has(form) || compactNames.has(compact(form))))
}

export type ChannelMatch = 'name' | 'alias' | 'both-scripts'

/**
 * HOW a channel title names the artist — kept on each track for audits
 * and hand-checked samples: the plain MB name, an alias alone, or the
 * name and an alias together.
 */
export function channelMatchKind(
  channelTitle: string,
  name: string,
  aliases: ArtistAlias[],
): ChannelMatch | null {
  if (channelMatchesArtist(channelTitle, channelNamesFor(name, []))) return 'name'
  if (channelMatchesArtist(channelTitle, channelNamesFor('', aliases))) return 'alias'
  if (channelMatchesArtist(channelTitle, channelNamesFor(name, aliases))) return 'both-scripts'
  return null
}

/** Scripts written without spaces between words: containment, not boundaries. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u

/**
 * Release titles that name a KIND of record, not a work: an upload that
 * says "Live" or "Greatest Hits" names no song (hand-check, Nov 19 2026:
 * "High Tone - X Ray - Live" matched the album "Live").
 */
const GENERIC_WORKS = new Set([
  'live', 'in concert', 'concert', 'greatest hits', 'best of', 'the best of', 'hits', 'the hits',
  'remixes', 'the remixes', 'remix', 'demo', 'demos', 'singles', 'the singles', 'collection',
  'the collection', 'anthology', 'ep', 'the ep', 'album', 'the album', 'lp', 'unplugged', 'acoustic',
  'instrumental', 'instrumentals', 'untitled', 'intro', 'outro', 'interlude', 'compilation', 'mixtape',
  'soundtrack', 'original soundtrack', 'karaoke', 'official', 'official video', 'music video',
])

/** Is this work key specific enough to identify anything? (exported for bulk builds) */
export function identifies(key: string): boolean {
  if (GENERIC_WORKS.has(key)) return false
  const chars = key.replace(/ /g, '').length
  return UNSPACED.test(key) ? chars >= 2 : chars >= 3
}

/** Does this video key name this work key? Both in matchKey form. */
export function names(videoKey: string, workKey: string): boolean {
  if (UNSPACED.test(workKey)) return videoKey.includes(workKey)
  return ` ${videoKey} `.includes(` ${workKey} `)
}

/**
 * A work whose title is the artist's own name, or part of it (a
 * self-titled record, "Lena" for Lena Horne). Every upload that names the
 * artist "contains" it, so it identifies nothing. Matching that is not
 * about the self-titled record itself leaves these out.
 */
export function isNameOnly(workTitle: string, artistName: string): boolean {
  const workKey = matchKey(workTitle)
  const nameKey = matchKey(artistName)
  if (!workKey || !nameKey) return false
  return names(nameKey, workKey)
}

/**
 * The artist's work this upload names, or null. Works are given
 * era-truest first; among the matches the longest title wins, and ties
 * keep that order.
 */
export function findWork<T extends Work>(videoTitle: string, works: T[]): T | null {
  const videoKey = matchKey(videoTitle)
  if (!videoKey) return null
  let best: { work: T; length: number } | null = null
  for (const work of works) {
    const workKey = matchKey(work.title)
    if (!workKey || !identifies(workKey) || !names(videoKey, workKey)) continue
    if (!best || workKey.length > best.length) best = { work, length: workKey.length }
  }
  return best?.work ?? null
}
