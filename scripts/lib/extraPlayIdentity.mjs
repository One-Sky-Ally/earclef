/**
 * Shared identity helpers for the gap-fill play repair
 * (gather-extra-play-evidence.mjs + arbitrate-extra-play-identity.mjs).
 *
 * Every comparison here is EXACT normalized equality over whole units —
 * whole titles, whole title segments, whole aliases. No containment, no
 * similarity (verified-play policy: fuzzy matching is banned as
 * verification). Coverage is widened only by enumerating VARIANTS of a
 * title (script sides of "A = B", sides of "A / B", decoration-stripped
 * forms, quoted spans) and comparing each variant exactly.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = process.cwd()
export const DATASET_PATH = join(ROOT, 'lib', 'explore', 'extra-artists.json')
export const PLAY_PATH = join(ROOT, 'lib', 'explore', 'extra-play.json')
export const EVIDENCE_DIR = join(ROOT, 'data', 'extra-play-evidence')
/** Discogs's "Various" pseudo-artist — never an identity. */
export const DISCOGS_VARIOUS_ID = 194930

export function env(name) {
  if (process.env[name]) return process.env[name]
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return null
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && match[1] === name) return match[2].trim()
  }
  return null
}

/** Same normalization as lib/play/resolve.ts — script-aware, exact. */
export function normalizeName(value) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function djb2(value) {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

/** MUST mirror extraPlayKey in lib/explore/extraArtists.ts exactly. */
export function extraPlayKey(artist) {
  if (artist.discogsArtistId) return `dg:${artist.discogsArtistId}`
  if (artist.wikidataId) return `wd:${artist.wikidataId}`
  const slug = artist.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `nm:${slug || `h${djb2(artist.name)}`}`
}

/** File name for an artist's evidence record (keys carry ':'). */
export function evidencePath(key) {
  return join(EVIDENCE_DIR, `${key.replace(/[^\w.-]/g, '_')}.json`)
}

export function videoIdOf(url) {
  const match = (url ?? '').match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/)
  return match?.[1] ?? match?.[2] ?? null
}

/** "3:44" / "1:02:10" → seconds; '' → null (missing is never a match). */
export function durationSeconds(value) {
  if (!value || typeof value !== 'string') return null
  const parts = value.trim().split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  return parts.reduce((total, part) => total * 60 + part, 0) || null
}

/** ISO-8601 "PT3M27S" → seconds. */
export function isoDurationSeconds(value) {
  const match = (value ?? '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  const [, h = 0, m = 0, s = 0] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s) || null
}

/** Load the gap-fill dataset as key → { artist, countries[] }. */
export function loadArtistsByKey() {
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
  const byKey = new Map()
  for (const [country, list] of Object.entries(dataset.countries)) {
    for (const artist of list) {
      const key = extraPlayKey(artist)
      const held = byKey.get(key)
      if (held) held.countries.push(country)
      else byKey.set(key, { artist, countries: [country] })
    }
  }
  return byKey
}

export function loadPlayEntries() {
  return JSON.parse(readFileSync(PLAY_PATH, 'utf8')).entries
}

/** The Discogs id an entry's link was sourced under (native or recovered). */
export function discogsIdOf(artist, entry) {
  return artist?.discogsArtistId ?? entry?.resolvedArtistId ?? null
}

/**
 * Alias set for exact comparison: dataset name, its "A = B" script
 * variants, owner-attested aliases, Discogs name / real name / name
 * variations, MusicBrainz name. Returned as NORMALIZED keys.
 */
export function aliasKeys(artist, profile, mbName) {
  const raw = [
    artist.name,
    ...artist.name.split('=').map((part) => part.replace(/\*\s*$/, '').trim()),
    ...(artist.aliases ?? []),
    profile?.name,
    profile?.realname,
    ...(profile?.namevariations ?? []),
    mbName,
  ]
  const keys = new Set()
  for (const value of raw) {
    const key = normalizeName(stripDiscogsDisambiguator(value ?? ''))
    if (key) keys.add(key)
  }
  return keys
}

/** Discogs names carry "(2)" disambiguators — never part of the name. */
export function stripDiscogsDisambiguator(name) {
  return name.replace(/\s*\(\d+\)\s*$/, '')
}

const TRAILING_GROUP = /\s*[([{][^()[\]{}]*[)\]}]\s*$/
const ANY_GROUP = /\s*[([{][^()[\]{}]*[)\]}]\s*/g
const LEADING_TRACK_NUMBER = /^\s*(?:[a-z]?\d{1,2}[.)\-:]?|\d{1,2}\s*[.)\-])\s+/i
const TRAILING_FEAT = /\s+(?:feat\.?|ft\.?|featuring|avec|con)\s+.+$/i
/**
 * Whole-span separators: a dash/bar/tilde/colon with whitespace on at
 * least one side (so "Jean-Pierre" and "Da-LiGs" never split), or a run
 * of two or more spaces — uploaders often type "Artist   Title".
 */
const SEGMENT_SPLIT = /\s+[-–—|·:~]\s*|\s*[-–—|·~]\s+|\s{2,}/

/**
 * Every whole-unit variant of a title, normalized. Used on BOTH sides
 * (upload titles and catalog titles) so "Поздрав На Пловдив = Salut À
 * Plovdiv" meets "Поздрав на Пловдив - Greetings to Plovdiv (…)" on the
 * Cyrillic side, and "Artist - Song (Official Video)" meets "Song".
 * Segments are whole spans between separators — never substrings.
 */
export function titleVariants(title, aliases = new Set()) {
  const out = new Set()
  const add = (value) => {
    const key = normalizeName(value)
    if (key) out.add(key)
  }
  const forms = new Set()
  const expand = (value) => {
    const trimmed = value.trim()
    if (!trimmed || forms.has(trimmed)) return
    forms.add(trimmed)
    add(trimmed)
    const noGroups = trimmed.replace(TRAILING_GROUP, '')
    if (noGroups !== trimmed) expand(noGroups)
    const noAnyGroup = trimmed.replace(ANY_GROUP, ' ')
    if (noAnyGroup !== trimmed) expand(noAnyGroup)
    const noNumber = trimmed.replace(LEADING_TRACK_NUMBER, '')
    if (noNumber !== trimmed) expand(noNumber)
    const noFeat = trimmed.replace(TRAILING_FEAT, '')
    if (noFeat !== trimmed) expand(noFeat)
    for (const side of trimmed.split(/\s+=\s+/)) if (side !== trimmed) expand(side)
    for (const side of trimmed.split(/\s*\/\s*/)) if (side !== trimmed) expand(side)
    for (const quoted of trimmed.matchAll(/["“«„]([^"”»“]+)["”»]/g)) expand(quoted[1])
    const segments = trimmed.split(SEGMENT_SPLIT).filter(Boolean)
    if (segments.length > 1) {
      // Drop segments that are the artist's own name; the rest stand alone.
      for (const segment of segments) {
        if (!aliases.has(normalizeName(segment))) expand(segment)
      }
    }
  }
  expand(title ?? '')
  // "Jairos jiri band Angifuni ukwendiswa": an alias at the very start
  // or very end of a title leaves the REST as a whole unit. Anchored at
  // the boundary and compared whole — not containment.
  for (const key of [...out]) {
    for (const alias of aliases) {
      if (key.length <= alias.length) continue
      if (key.startsWith(alias)) out.add(key.slice(alias.length))
      if (key.endsWith(alias)) out.add(key.slice(0, key.length - alias.length))
    }
  }
  // An alias alone is a NAME, never a title — remove it from the variants.
  for (const alias of aliases) out.delete(alias)
  return out
}

/** Does any variant of `a` equal any variant of `b`? Exact keys only. */
export function variantsIntersect(a, b) {
  for (const key of a) if (b.has(key)) return true
  return false
}

/** YouTube channel ids (UC…) from a list of channel URLs — ID-level only. */
export function channelIdsFromUrls(urls) {
  const ids = new Set()
  for (const url of urls ?? []) {
    const match = (url ?? '').match(/youtube\.com\/channel\/(UC[\w-]{22})/)
    if (match) ids.add(match[1])
  }
  return ids
}
