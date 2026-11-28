/**
 * Discover verification: every candidate written during /refresh-earclef
 * is checked before it can reach the page — the artist must exist on
 * MusicBrainz under exactly that name, the knownFor title must be in
 * their real catalogue (else their own top release replaces it), and a
 * playable song is looked for (Discogs record videos and the artist's
 * own channel, under the site's identity bar). Runs LOCALLY in the
 * refresh session (scripts/discover-stock.mjs) — no model call, no
 * server-side job. The site's verified-data bar applies to AI output too.
 */
import {
  bandcampRel,
  mbAliasNames,
  resolveMbArtistPlay,
  type MbArtistBody,
} from '../play/resolve'
import { artistLinksFromRelations, type ArtistLinks } from '../listen/artistLinks'
import { fetchMusicBrainzJson } from './mbFetch'
import { resolveDiscoverSongs, type DiscoverSong } from './song'
import { normalizeName, titleVariants, variantsIntersect } from '../play/titleVariants'
import { MAX_MORE_SONGS, type DiscoverPick, type RawPick } from './types'

/**
 * Letters NFD leaves whole, spelled out: "Mediæval Bæbes" on MusicBrainz
 * is "Mediaeval Baebes" as credited elsewhere (owner, Nov 23 2026: a
 * spelling form never decides whether it is the right artist).
 */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
}

export function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[æœøßłđðþı]/g, (letter) => LETTER_FOLDS[letter] ?? letter)
    .replace(/\band\b/g, '&')
    .replace(/[^a-z0-9&]+/g, '')
}

/** The name without a leading "The": "Mike Flowers Pops" meets "The Mike Flowers Pops". */
export function withoutArticle(name: string): string {
  return normalize(name.replace(/^\s*the\s+/i, ''))
}

/**
 * What to search MusicBrainz for: the name without a leading "The", so
 * "The Dirty Heads" also finds "Dirty Heads" (a phrase search needs every
 * word) — except when nothing but "The" would be left ("The The").
 */
export function searchName(name: string): string {
  const bare = name.replace(/^\s*the\s+/i, '').trim()
  const key = normalize(bare)
  return key && key !== 'the' ? bare : name.trim()
}

/** Only real roster slugs, at most three, in the candidate's order. */
export function rosterLinks(slugs: unknown, rosterSlugs: ReadonlySet<string>): string[] {
  if (!Array.isArray(slugs)) return []
  return [...new Set(slugs.filter((slug): slug is string => typeof slug === 'string'))]
    .filter((slug) => rosterSlugs.has(slug))
    .slice(0, 3)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How a MusicBrainz artist is named like the candidate. */
export type NamedBy = 'name' | 'alias' | 'article'

export interface MbArtistMatch {
  mbid: string
  canonicalName: string
  namedBy: NamedBy
}

export interface NameMatches {
  /** Every result named like the candidate: as written first, then an alternate name, then without "The". */
  matches: MbArtistMatch[]
  /**
   * The name alone proves who it is: the top result, named as written,
   * and no other result shares the name. Anything less and the
   * candidate's knownFor title must be in the artist's catalogue.
   */
  byNameAlone: boolean
}

interface MbSearchArtist {
  id: string
  name: string
  score: number
  'sort-name'?: string
  aliases?: { name?: string; 'sort-name'?: string }[]
}

/** The artist's other names on MusicBrainz: sort name and aliases. */
function otherNames(artist: MbSearchArtist): string[] {
  return [
    artist['sort-name'] ?? '',
    ...(artist.aliases ?? []).flatMap((alias) => [alias.name ?? '', alias['sort-name'] ?? '']),
  ].filter(Boolean)
}

/**
 * Every search result named like the candidate — the right-artist rule
 * (owner, Nov 19 + Nov 24 2026): a name, an alternate name or a spelling
 * never decides on its own WHICH artist it is; the knownFor title does.
 *   · as written (spacing, case, accents and ligatures aside): DANGERDOOM
 *     is "Danger Doom";
 *   · an alternate name MusicBrainz lists — sort name or alias: 幾何学模様
 *     is "Kikagaku Moyo", DJ Cheb i Sabbah is "Cheb i Sabbah";
 *   · the same name once a leading "The" is set aside.
 * No search-score bar: the score ranks namesakes, it never proved anyone
 * (TOPS scored 82 under the Four Tops, Pullman 83 under Philip Pullman).
 */
export function nameMatches(artists: readonly MbSearchArtist[], name: string): NameMatches {
  const key = normalize(name)
  const bare = withoutArticle(name)
  if (!key) return { matches: [], byNameAlone: false }
  const namedBy = (artist: MbSearchArtist): NamedBy | null => {
    if (normalize(artist.name) === key) return 'name'
    if (otherNames(artist).some((other) => normalize(other) === key)) return 'alias'
    if (bare && bare !== 'the' && withoutArticle(artist.name) === bare) return 'article'
    return null
  }
  const ranked = artists.flatMap((artist, at) => {
    const how = namedBy(artist)
    return how ? [{ at, match: { mbid: artist.id, canonicalName: artist.name, namedBy: how } }] : []
  })
  const order: Record<NamedBy, number> = { name: 0, alias: 1, article: 2 }
  const matches = [...ranked]
    .sort((a, b) => order[a.match.namedBy] - order[b.match.namedBy] || a.at - b.at)
    .map((entry) => entry.match)
  const only = ranked.length === 1 ? ranked[0] : null
  return { matches, byNameAlone: only !== null && only.at === 0 && only.match.namedBy === 'name' }
}

/** Results named like the candidate, null when MusicBrainz never answered. */
async function searchMusicBrainz(name: string, asked: string): Promise<NameMatches | null> {
  // No field: MusicBrainz then searches names, aliases and sort names, so
  // "Danger Doom" finds DANGERDOOM and "Kikagaku Moyo" finds 幾何学模様.
  const query = encodeURIComponent(`"${asked.replace(/["\\]/g, '')}"`)
  const url = `https://musicbrainz.org/ws/2/artist?query=${query}&limit=10&fmt=json`
  const res = await fetchMusicBrainzJson(url)
  if (!res.ok) return res.unavailable ? null : { matches: [], byNameAlone: false }
  const body = res.body as { artists?: MbSearchArtist[] } | null
  // A busy MusicBrainz can answer 200 with an error body: not an answer.
  if (!Array.isArray(body?.artists)) return null
  return nameMatches(body.artists, name)
}

/**
 * The name as written first; only when that finds no one, the name
 * without a leading "The" ("The Dirty Heads" are "Dirty Heads"). Searching
 * the bare name first would bury "The Heads" under Talking Heads.
 */
async function verifyOnMusicBrainz(name: string): Promise<NameMatches | 'unavailable'> {
  const asWritten = await searchMusicBrainz(name, name)
  if (asWritten === null) return 'unavailable'
  const bare = searchName(name)
  if (asWritten.matches.length > 0 || bare === name.trim()) return asWritten
  await sleep(1100) // MusicBrainz rate limit: 1 req/s
  return (await searchMusicBrainz(name, bare)) ?? 'unavailable'
}

interface MbReleaseGroup {
  title?: string
  'first-release-date'?: string
  'primary-type'?: string
  'secondary-types'?: string[]
}

interface VerifiedCatalog {
  knownFor: string
  /** The proposed title was not found and the artist's own top release took its place. */
  replaced: boolean
  /** The artist's release-group titles, knownFor first then newest first. */
  titles: string[]
  /** Studio album titles, newest first: the Discogs read takes these next. */
  albums: string[]
}

/** Album release groups with no secondary type (no live, compilation, …), newest first. */
export function studioAlbums(groups: readonly MbReleaseGroup[]): string[] {
  return groups
    .filter((group): group is MbReleaseGroup & { title: string } => Boolean(group.title))
    .filter((group) => group['primary-type'] === 'Album' && (group['secondary-types'] ?? []).length === 0)
    .sort((a, b) => (b['first-release-date'] ?? '').localeCompare(a['first-release-date'] ?? ''))
    .map((group) => group.title)
}

/**
 * One of the artist's recordings IS the title, as a whole unit — the
 * search is a phrase match, so "Blue" also returns "Blue Moon" and
 * "Feeling Blue" (review, Nov 24 2026: with namesakes judged by this,
 * containment could choose the wrong artist).
 */
export function namesRecording(recordings: readonly { title?: string }[], proposed: string): boolean {
  const wanted = titleVariants(proposed)
  return wanted.size > 0 && recordings.some((recording) => variantsIntersect(titleVariants(recording.title), wanted))
}

/** Catalog titles for the song resolver's channel path, newest first. */
function catalogTitles(groups: MbReleaseGroup[], knownFor: string): string[] {
  const dated = groups
    .filter((group): group is MbReleaseGroup & { title: string } => Boolean(group.title))
    .sort((a, b) =>
      (b['first-release-date'] ?? '').localeCompare(a['first-release-date'] ?? ''),
    )
    .map((group) => group.title)
  const seen = new Set<string>()
  return [knownFor, ...dated].filter((title) => {
    const key = normalize(title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Verify the model's knownFor title against the artist's real catalog:
 * a normalized match among their release groups, else one recording
 * search. No match → the artist's own top release replaces it (latest
 * dated album, else latest dated anything, else the first group). An
 * artist with no catalog at all returns null and the pick is dropped;
 * MusicBrainz not answering is 'unavailable', never "no catalogue"
 * (Nov 23, 2026: Dirty Heads skipped while MusicBrainz was busy).
 */
async function verifiedKnownFor(
  mbid: string,
  proposed: string,
): Promise<VerifiedCatalog | null | 'unavailable'> {
  const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`
  const rgRes = await fetchMusicBrainzJson(rgUrl)
  if (!rgRes.ok && rgRes.unavailable) return 'unavailable'
  const rgBody = rgRes.ok ? (rgRes.body as { 'release-groups'?: MbReleaseGroup[] } | null) : null
  // A 200 with an error body is a busy server, not an empty catalogue.
  if (rgRes.ok && !Array.isArray(rgBody?.['release-groups'])) return 'unavailable'
  // any other failed read is treated as an empty catalog below
  const groups: MbReleaseGroup[] = rgBody?.['release-groups'] ?? []
  await sleep(1100) // MusicBrainz rate limit: 1 req/s

  const proposedKey = normalize(proposed)
  if (
    proposedKey &&
    groups.some((group) => normalize(group.title ?? '') === proposedKey)
  ) {
    return { knownFor: proposed, replaced: false, titles: catalogTitles(groups, proposed), albums: studioAlbums(groups) }
  }

  const query = encodeURIComponent(
    `recording:"${proposed.replace(/"/g, '')}" AND arid:${mbid}`,
  )
  const recordings = await fetchMusicBrainzJson(
    `https://musicbrainz.org/ws/2/recording?query=${query}&limit=25&fmt=json`,
  )
  await sleep(1100)
  // Busy is not "the title isn't theirs": a replaced title would reject
  // a match found below a namesake or without "The".
  if (!recordings.ok && recordings.unavailable) return 'unavailable'
  const recordingBody = recordings.ok ? (recordings.body as { recordings?: { title?: string }[] } | null) : null
  if (recordings.ok && !Array.isArray(recordingBody?.recordings)) return 'unavailable'
  if (namesRecording(recordingBody?.recordings ?? [], proposed)) {
    return { knownFor: proposed, replaced: false, titles: catalogTitles(groups, proposed), albums: studioAlbums(groups) }
  }

  const dated = groups
    .filter((group) => group.title && group['first-release-date'])
    .sort((a, b) =>
      (b['first-release-date'] ?? '').localeCompare(
        a['first-release-date'] ?? '',
      ),
    )
  const replacement =
    dated.find((group) => group['primary-type'] === 'Album') ??
    dated[0] ??
    groups.find((group) => group.title)
  return replacement?.title
    ? {
        knownFor: replacement.title,
        replaced: true,
        titles: catalogTitles(groups, replacement.title),
        albums: studioAlbums(groups),
      }
    : null
}

/**
 * The names the song step knows the artist by: their MusicBrainz name,
 * every alias except search hints (misspellings people type), and the
 * alternate name that found them. Untyped aliases count (Nov 24, 2026):
 * "Rufus & Chaka Khan" and "Cheb I Sabbah" are untyped on MusicBrainz,
 * so their own Topic channels read "not trusted". Discover only — the
 * play resolver's identity names (mbAliasNames) stay typed-only.
 */
export function songNames(artist: MbArtistBody | null, foundAs: string | null): string[] {
  const listed = (artist?.aliases ?? []).flatMap((alias) =>
    alias.name && alias.type !== 'Search hint' ? [alias.name] : [],
  )
  return [...new Set([...mbAliasNames(artist), ...listed, ...(foundAs ? [foundAs] : [])])]
}

/** Namesakes whose catalogue is read at most, best named first. */
const MAX_NAMESAKES = 5

type Chosen = { match: MbArtistMatch; catalog: VerifiedCatalog }

/**
 * Which artist the candidate is. When the name alone proves it, that
 * artist — their own top release stands in if the knownFor title is not
 * theirs. Otherwise every artist named like the candidate is judged by
 * the knownFor title (owner, Nov 24 2026: TOPS sits under the Four Tops
 * beside a J-pop TOPS and a schlager Tops; "Sugar at the Gate" says which).
 */
async function chooseArtist(
  found: NameMatches,
  knownFor: string,
  trace?: (line: string) => void,
): Promise<Chosen | null | 'unavailable' | 'no catalogue'> {
  if (found.byNameAlone) {
    const match = found.matches[0]
    trace?.(`musicbrainz: ${match.canonicalName} (${match.mbid}), the only artist by that name`)
    const catalog = await verifiedKnownFor(match.mbid, knownFor)
    if (catalog === 'unavailable') return 'unavailable'
    return catalog ? { match, catalog } : 'no catalogue'
  }
  const confirmed: Chosen[] = []
  for (const match of found.matches.slice(0, MAX_NAMESAKES)) {
    const catalog = await verifiedKnownFor(match.mbid, knownFor)
    if (catalog === 'unavailable') return 'unavailable'
    const how = match.namedBy === 'name' ? 'named alike' : match.namedBy === 'alias' ? 'by an alternate name' : 'without "The"'
    const theirs = Boolean(catalog && !catalog.replaced)
    trace?.(`musicbrainz: ${match.canonicalName} (${match.mbid}), ${how}; "${knownFor}" ${theirs ? 'is theirs' : 'is not in their catalogue'}`)
    if (catalog && theirs) confirmed.push({ match, catalog })
  }
  // Every namesake is judged: two who both have the title leave it open.
  if (confirmed.length > 1) trace?.(`musicbrainz: ${confirmed.length} artists named alike have "${knownFor}" — no way to tell which`)
  return confirmed.length === 1 ? confirmed[0] : null
}

export interface VerifyContext {
  /** Normalized roster names and slugs: anyone on Ear Clef is never a pick. */
  rosterKeys: ReadonlySet<string>
  /** Roster MusicBrainz ids: an artist found by another spelling is still on the roster. */
  rosterMbids?: ReadonlySet<string>
  rosterSlugs: ReadonlySet<string>
  /** Epoch ms: no song search starts after this. */
  songDeadline: number
  /** Discogs records read at most for the song (the local run reads deeper). */
  maxRecords?: number
  /** Step-by-step notes — `npm run discover-stock -- why "<artist>"`. */
  trace?: (line: string) => void
}

export interface VerifyResult {
  pick: DiscoverPick | null
  /** Why a candidate was left out. */
  reason?:
    | 'on the roster'
    | 'not on MusicBrainz'
    | 'musicbrainz unavailable'
    | 'song lookup unavailable'
    | 'no catalogue'
    | 'no playable song'
}

/**
 * One candidate → a verified pick, or the reason it was left out: not
 * on MusicBrainz under that exact name, on the roster already, no
 * catalogue — or NO PLAYABLE SONG. Discover shows only picks that play
 * here (owner ruling, Oct 15 2026: the Songs-about rule), so a pick
 * without a verified song is never stocked. MusicBrainz is paced at
 * 1 request/s inside; Discogs paces itself.
 */
export async function verifyCandidate(
  candidate: RawPick,
  context: VerifyContext,
): Promise<VerifyResult> {
  const trace = context.trace
  const key = normalize(candidate.name)
  if (!key || context.rosterKeys.has(key)) return { pick: null, reason: 'on the roster' }
  const found = await verifyOnMusicBrainz(candidate.name)
  await sleep(1100) // MusicBrainz rate limit: 1 req/s
  if (found === 'unavailable') {
    trace?.(`musicbrainz: no answer for "${candidate.name}" after retries`)
    return { pick: null, reason: 'musicbrainz unavailable' }
  }
  if (found.matches.length === 0) {
    trace?.(`musicbrainz: no artist named "${candidate.name}" (name, alias or sort name)`)
    return { pick: null, reason: 'not on MusicBrainz' }
  }
  const chosen = await chooseArtist(found, candidate.knownFor, trace)
  if (chosen === 'unavailable') {
    trace?.(`musicbrainz: no answer for a catalogue of "${candidate.name}"`)
    return { pick: null, reason: 'musicbrainz unavailable' }
  }
  if (chosen === 'no catalogue') return { pick: null, reason: 'no catalogue' }
  if (!chosen) return { pick: null, reason: 'not on MusicBrainz' }
  const { match, catalog } = chosen
  if (context.rosterKeys.has(normalize(match.canonicalName)) || context.rosterMbids?.has(match.mbid)) {
    return { pick: null, reason: 'on the roster' }
  }
  trace?.(`catalogue: known for "${catalog.knownFor}"; ${catalog.titles.length} release-group titles`)

  // One MB artist call feeds the play chain AND the song resolver. Its
  // url relations are the ONLY way to the artist's Discogs and YouTube
  // pages, so a call that never answers must not read as "no song"
  // (Oct 27, 2026: Glass Animals, Kings of Convenience skipped in a burst).
  const artistRes = await fetchMusicBrainzJson(
    `https://musicbrainz.org/ws/2/artist/${match.mbid}?inc=url-rels+aliases&fmt=json`,
  )
  await sleep(1100)
  if (!artistRes.ok) {
    if (artistRes.unavailable) {
      trace?.(`musicbrainz: no answer for the artist record of ${match.canonicalName}`)
      return { pick: null, reason: 'musicbrainz unavailable' }
    }
    trace?.(`musicbrainz: no artist record for ${match.mbid}`)
  }
  const artist = artistRes.ok ? (artistRes.body as MbArtistBody) : null
  const { play, read } = await resolveMbArtistPlay(match.mbid, null, artist)
  let lookupFailed = false
  const aliases = songNames(artist, match.namedBy === 'alias' ? candidate.name : null)
  const songs = await resolveDiscoverSongs({
    name: match.canonicalName,
    knownFor: catalog.knownFor,
    relations: artist?.relations ?? [],
    aliases,
    titles: catalog.titles,
    albums: catalog.albums,
    deadline: context.songDeadline,
    maxRecords: context.maxRecords,
    trace,
    onUnavailable: () => {
      lookupFailed = true
    },
  })
  const song = songs[0] ?? null
  // A miss while Discogs or YouTube was not answering is not a verdict.
  if (!song) return { pick: null, reason: lookupFailed ? 'song lookup unavailable' : 'no playable song' }
  const pick: DiscoverPick = {
    name: match.canonicalName,
    why: candidate.why,
    knownFor: catalog.knownFor,
    knownForVerified: true,
    mbid: match.mbid,
    play,
    read: read ?? {
      kind: 'musicbrainz',
      url: `https://musicbrainz.org/artist/${match.mbid}`,
    },
    listenHref: play?.url ?? read?.url ?? `https://musicbrainz.org/artist/${match.mbid}`,
    song,
    more: moreSongs(songs, song, aliases),
    services: artistLinksFromRelations(artist?.relations),
    bandcamp: bandcampRel(artist?.relations),
    connectsTo: rosterLinks(candidate.connectsTo, context.rosterSlugs),
  }
  return { pick }
}

/**
 * "More from this artist" (owner, Nov 28 2026): the ranked songs after
 * the pick's own — never its video, never the same song again under
 * another title form, at most MAX_MORE_SONGS. Every one passed the same
 * identity bar as the pick's song (./song rankSongs).
 */
export function moreSongs(
  songs: readonly DiscoverSong[],
  own: Pick<DiscoverSong, 'videoId' | 'title'> | null,
  aliases: readonly string[],
): DiscoverSong[] {
  const keys = new Set(aliases.map(normalizeName).filter((key) => key !== ''))
  const ownTitle = own ? titleVariants(own.title, keys) : new Set<string>()
  return songs
    .filter((song) => song.videoId !== own?.videoId && !variantsIntersect(titleVariants(song.title, keys), ownTitle))
    .slice(0, MAX_MORE_SONGS)
}

export interface Enriched {
  more: DiscoverSong[]
  services: ArtistLinks
  /** The pick's stored song is still among the verified songs under today's rules. */
  ownStillVerified: boolean
  /** Today's best verified song — the replacement to hand-check when the stored one fell out. */
  best: DiscoverSong | null
}

/**
 * More songs and the "Listen on" links for a pick ALREADY stocked: the
 * same artist by the stored MusicBrainz id (never a new name search),
 * the same song chain and bar as stocking. 'unavailable' when
 * MusicBrainz, Discogs or YouTube did not answer — not a verdict; the
 * next run reads the artist again.
 */
export async function enrichPick(
  pick: Pick<DiscoverPick, 'mbid' | 'name' | 'knownFor' | 'song'>,
  context: Pick<VerifyContext, 'songDeadline' | 'maxRecords' | 'trace'>,
): Promise<Enriched | 'unavailable'> {
  const catalog = await verifiedKnownFor(pick.mbid, pick.knownFor)
  if (catalog === 'unavailable') return 'unavailable'
  const artistRes = await fetchMusicBrainzJson(
    `https://musicbrainz.org/ws/2/artist/${pick.mbid}?inc=url-rels+aliases&fmt=json`,
  )
  await sleep(1100)
  if (!artistRes.ok && artistRes.unavailable) return 'unavailable'
  const artist = artistRes.ok ? (artistRes.body as MbArtistBody) : null
  const aliases = songNames(artist, null)
  let lookupFailed = false
  const songs = await resolveDiscoverSongs({
    name: pick.name,
    knownFor: catalog?.knownFor ?? pick.knownFor,
    relations: artist?.relations ?? [],
    aliases,
    titles: catalog?.titles ?? [pick.knownFor],
    albums: catalog?.albums ?? [],
    deadline: context.songDeadline,
    maxRecords: context.maxRecords,
    trace: context.trace,
    onUnavailable: () => {
      lookupFailed = true
    },
  })
  if (songs.length === 0 && lookupFailed) return 'unavailable'
  return {
    more: moreSongs(songs, pick.song, aliases),
    services: artistLinksFromRelations(artist?.relations),
    ownStillVerified: Boolean(pick.song && songs.some((song) => song.videoId === pick.song?.videoId)),
    best: songs[0] ?? null,
  }
}
