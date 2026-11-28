/**
 * The version a video plays, in the upload's own words (Nov 26, 2026;
 * owner: "when a video is a remix, the label should say so"). Matching
 * sets bracketed notes aside, so dead prez's "Hell Yeah (Pimp the
 * System) (Remix)" and The Puppini Sisters' "… [The Gentleman Callers
 * of LA Remix]" were shown as the plain songs. The other half of
 * shownSongTitle (./titleVariants): a note the video lacks comes off, a
 * version note the video carries goes on.
 *
 * The vocabulary mirrors VERSION_WORDS in scripts/lib/songsAboutPlaces.mjs
 * (which tags Songs-about videos by meaning). The parts of the upload
 * title that annotate — a bracketed group, a dash or bar segment, the
 * text after a quoted title — are read with the song's title cut out;
 * a part that carries the artist's credit, a featured or "with" credit,
 * or "from the album …" is never read, so a band called Dub Trio or a
 * song called "Live and Let Die" is never a version.
 *
 * Relative imports only: bundled into the Netlify background function.
 */
import { normalizeName, shownSongTitle } from './titleVariants'

/** Longer than this, the note is shown as its plain word ("Live"). */
const MAX_NOTE_CHARS = 48

const words = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu')

/** By meaning, first match wins: "extended remix" is a remix. Read over spaced, folded text. */
const KINDS: readonly (readonly [RegExp, string])[] = [
  [words('remix(?:es)?|rmx|re mix|mix|rework|refix|re edit|bootleg|mash ?up|vip|dub'), 'Remix'],
  [words('live|unplugged|in concert|sessions?|en vivo|ao vivo|en directo|en concierto'), 'Live'],
  [words('demo'), 'Demo'],
  [words('acoustic|acustic[oa]|acoustique'), 'Acoustic'],
  [words('instrumental'), 'Instrumental'],
  [words('edit|extended|tv size'), 'Edit'],
  [words('alternate|alternative take|take \\d+|reprise|medley|sped up|slowed'), 'Alternate take'],
  [words('cover'), 'Cover'],
  [
    words(
      'en (?:espanol|ingles|frances|francais|anglais|italiano|portugues)|in (?:english|spanish|french|german|italian|portuguese|japanese|korean)',
    ),
    'Language version',
  ],
  [words('version[ei]?|[\\p{L}\\p{N}]+ ver'), 'Version'],
]

/**
 * The plain record under another name: never a version. Either word
 * order, a year allowed ("Remastered 2009 Version", "Versión Original").
 * A stereo or mono MIX is a version (a 2017 remix, a 1966 re-recording).
 */
const PLAIN_QUALIFIER = 'album|single|lp|original[ea]?|full|official|explicit|clean|dirty|main|video|music video|remaster(?:ed)?'
const PLAIN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?:\\d{4} )?(?:${PLAIN_QUALIFIER})(?: \\d{4})? (?:version[ei]?|ver|mix)|(?:version[ei]?|ver) (?:${PLAIN_QUALIFIER})|cover art|album cover)(?![\\p{L}\\p{N}])`,
  'giu',
)

/** Words that say what kind of upload it is, never which version — read only at a note's edges. */
const NOISE_WORD = /^(?:official|officiel|oficial|music|video|vídeo|videoclip|clip|audio|lyric|lyrics|visuali[sz]er|hd|hq|4k|mv|m\/v)$/iu
/** "Live in 4K" keeps its 4K: a noise word right after one of these is part of the note. */
const PREPOSITION = /^(?:in|at|from|on|with|for|of|en|à|a|de|live)$/iu

/** A part that credits someone or names the record, never a version. */
const CREDIT_PIECE = /^(?:feat\.?|ft\.?|featuring|with|w\/|&|\+|x|vs\.?|from|taken from|prod\.?|produced by)(?![\p{L}\p{N}])/iu

const GROUP = /[([{（［【〔]([^()[\]{}（）［］【】〔〕]*)[)\]}）］】〕]/g
/** Same whole-span separators as ./titleVariants: never "Jean-Pierre". */
const SEGMENT_SPLIT = /\s+[-–—|·:~]\s*|\s*[-–—|·~]\s+|\s{2,}/
/** Double quotes, but never an inch mark: 12" and 7" are versions' own names. */
const DOUBLE_QUOTES = /(?<!\d)["“”«»„「」『』]/g
const BRACKETS = /[()[\]{}（）［］【】〔〕]/g
const AFTER_QUOTED = /[”"」』»]\s*([^"“”「『«»」』]+)$/
const TRAILING_FEAT = /\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i

const decodeEntities = (value: string) =>
  value.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')

const spaced = (value: string) =>
  ` ${value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `text` without `phrase`, matched word by word whatever the
 * punctuation between ("Don't" = "Dont"; "and" = "&").
 */
function withoutPhrase(text: string, phrase: string): string {
  const parts = phrase.normalize('NFC').replace(/&/g, ' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (parts.length === 0) return text
  const body = parts
    .map((part) => (/^and$/i.test(part) ? '(?:and|&|\\+)' : escapeRegExp(part)))
    .join('[^\\p{L}\\p{N}]*')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
  return text.normalize('NFC').replace(pattern, ' ')
}

/** "Song (feat. X)" → "Song": the forms a title is cut by. */
function bareTitle(songTitle: string): string {
  return songTitle.replace(GROUP, ' ').replace(TRAILING_FEAT, '').replace(/\s+/g, ' ').trim()
}

/** Does `text` still carry `phrase` as whole words? */
function carries(text: string, phrase: string): boolean {
  const key = spaced(phrase)
  return key.trim() !== '' && spaced(text).includes(key)
}

/** The parts of an upload title that annotate, in reading order. */
function notePieces(uploadTitle: string): string[] {
  const groups = [...uploadTitle.matchAll(GROUP)].map((match) => match[1])
  const plain = uploadTitle.replace(GROUP, '  ')
  const segments = plain.split(SEGMENT_SPLIT)
  const afterQuote = plain.match(AFTER_QUOTED)?.[1]
  return [...groups, ...segments, ...(afterQuote ? [afterQuote] : [])]
    .map((piece) => piece.trim())
    .filter(Boolean)
}

/** Does this text name a version (a live take, a remix, a demo …)? */
export function namesVersion(text: string): boolean {
  return kindOf(text) !== null
}

function kindOf(text: string): string | null {
  const folded = spaced(text).replace(PLAIN, ' ')
  return KINDS.find(([pattern]) => pattern.test(folded))?.[1] ?? null
}

/** Noise words off a note's edges, never one a preposition leads into ("Live in 4K"). */
function trimNoise(tokens: readonly string[]): string[] {
  const bare = (token: string) => token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
  let start = 0
  let end = tokens.length
  while (start < end && NOISE_WORD.test(bare(tokens[start]))) start++
  while (end > start && NOISE_WORD.test(bare(tokens[end - 1])) && !(end - 2 >= start && PREPOSITION.test(bare(tokens[end - 2])))) end--
  return tokens.slice(start, end)
}

function cleaned(text: string): string {
  const tokens = text.replace(DOUBLE_QUOTES, ' ').replace(BRACKETS, ' ').split(/\s+/).filter(Boolean)
  return trimNoise(tokens)
    .join(' ')
    .replace(/^[\s\-–—|:~·,;.]+|[\s\-–—|:~·,;]+$/g, '')
    .trim()
}

/** A part naming the artist (their credit, a co-credit) — with or without a leading "The". */
function creditsArtist(piece: string, artistName: string): boolean {
  const names = [artistName, artistName.replace(/^the\s+/i, '')].filter((name) => normalizeName(name) !== '')
  return names.some((name) => carries(piece, name))
}

/**
 * The upload's own version note ("Magician Remix", "Live from
 * Copenhagen", "Demo"), or null when the video is the plain record.
 */
export function versionNote(uploadTitle: string, songTitle: string, artistName: string): string | null {
  const bare = bareTitle(songTitle)
  for (const raw of notePieces(decodeEntities(uploadTitle ?? ''))) {
    if (CREDIT_PIECE.test(raw) || creditsArtist(raw, artistName)) continue
    const rest = withoutPhrase(withoutPhrase(raw, songTitle), bare)
    // The title survived the cut (spelled otherwise): its own words could be the marker.
    if (carries(rest, bare)) continue
    const kind = kindOf(rest)
    if (!kind) continue
    const note = cleaned(rest)
    return note && note.length <= MAX_NOTE_CHARS && kindOf(note) ? note : kind
  }
  return null
}

/** The notes a title already carries: its bracketed groups and any segment after its first. */
function titleNotes(title: string): string[] {
  const groups = [...title.matchAll(GROUP)].map((match) => match[1])
  const segments = title.replace(GROUP, '  ').split(SEGMENT_SPLIT).slice(1)
  return [...groups, ...segments].map((piece) => piece.trim()).filter(Boolean)
}

/**
 * The song's title as shown for this video: notes the video lacks come
 * off (shownSongTitle), a version the video plays goes on — once.
 */
export function labelledSongTitle(
  songTitle: string,
  uploadTitle: string,
  artistName: string,
  aliases: ReadonlySet<string> = new Set(),
): string {
  const title = shownSongTitle(songTitle, uploadTitle, aliases)
  const note = versionNote(uploadTitle, songTitle, artistName)
  if (!note) return title
  // The title's own note, kept because the video carries it, already says which version.
  const said = titleNotes(title).some((piece) => kindOf(piece) !== null || normalizeName(piece) === normalizeName(note))
  return said ? title : `${title} (${note})`
}
