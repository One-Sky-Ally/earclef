/**
 * Shared readers for the Artist Chapters passes (build-presence-edges,
 * sweep-wikidata-residence): where the globe files each artist today,
 * the globe's own names for places, and the gap-fill play key the
 * server keys entries by. All local, all by id.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CLAIMED_PLACES } from '../../lib/explore/claimedPlaces.ts'

export const POOL_PATH = 'lib/explore/extra-artists.json'
export const CORRECTIONS_PATH = 'lib/explore/origin-corrections.json'
export const COUNTRY_DIR = 'lib/explore/country-artists'
const HISTORICAL_PATH = 'lib/explore/historical-area-artists.json'
const CLAIMED_DIR = 'lib/explore/claimed-places'
const SELF_FILED_PATH = 'lib/explore/self-filed.json'
const ARTIST_LINKS_DIR = 'data/mb-dump/artist-links'

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** code → name, from the committed country files (the globe's own names) plus the claimed places. */
export function countryNames() {
  const names = new Map()
  for (const file of readdirSync(COUNTRY_DIR)) {
    if (!file.endsWith('.json')) continue
    const stored = readJson(join(COUNTRY_DIR, file))
    if (stored.name) names.set(file.replace('.json', ''), stored.name)
  }
  for (const place of CLAIMED_PLACES) names.set(place.id, place.name)
  return names
}

/** The verified-play key the server uses for a gap-fill entry (extraArtistsServer.ts, ported exactly). */
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

function djb2(value) {
  let hash = 5381
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  return hash.toString(16)
}

/**
 * The globe's own place for each MusicBrainz artist — the country files
 * with origin corrections applied (a corrected artist shows under `to`),
 * the historical-area roster, claimed places and self-filed entries —
 * with name and tags. mbid → { name, home, tags }. An artist filed in
 * two of these keeps the first (country file wins).
 */
export function mbHomes() {
  const moves = readJson(CORRECTIONS_PATH).moves ?? {}
  const homes = new Map()
  const add = (mbid, record) => {
    if (!homes.has(mbid)) homes.set(mbid, record)
  }
  for (const file of readdirSync(COUNTRY_DIR)) {
    if (!file.endsWith('.json')) continue
    const code = file.replace('.json', '')
    for (const artist of readJson(join(COUNTRY_DIR, file)).artists ?? []) {
      add(artist.id, { name: artist.name, home: moves[artist.id]?.to ?? code, tags: artist.t ?? [], ended: artist.end ?? null })
    }
  }
  if (existsSync(HISTORICAL_PATH)) {
    for (const [code, artists] of Object.entries(readJson(HISTORICAL_PATH).countries ?? {})) {
      for (const artist of artists) add(artist.mbid, { name: artist.name, home: code, tags: artist.tags ?? [], ended: artist.lifeEnd ?? null })
    }
  }
  if (existsSync(CLAIMED_DIR)) {
    for (const file of readdirSync(CLAIMED_DIR)) {
      if (!file.endsWith('.json')) continue
      const claimed = readJson(join(CLAIMED_DIR, file))
      for (const artist of claimed.artists ?? []) add(artist.mbid, { name: artist.name, home: claimed.placeId, tags: artist.tags ?? [] })
    }
  }
  if (existsSync(SELF_FILED_PATH)) {
    for (const artist of readJson(SELF_FILED_PATH).artists ?? []) add(artist.mbid, { name: artist.name, home: artist.country, tags: artist.tags ?? [] })
  }
  return homes
}

/** Every gap-fill pool entry with its key and home: [{ key, home, name, wikidataId, entry }]. Archive entries included (callers decide). */
export function gapFillArtists(pool = readJson(POOL_PATH)) {
  const rows = []
  for (const [code, list] of Object.entries(pool.countries)) {
    for (const entry of list) rows.push({ key: extraPlayKey(entry), home: code, name: entry.name, wikidataId: entry.wikidataId ?? null, entry })
  }
  return rows
}

/** mbid → Wikidata QID from the local MusicBrainz URL-relation index. */
export function mbWikidataIds(wanted) {
  const ids = new Map()
  for (const file of readdirSync(ARTIST_LINKS_DIR)) {
    if (!file.endsWith('.jsonl')) continue
    for (const line of readFileSync(join(ARTIST_LINKS_DIR, file), 'utf8').split('\n')) {
      if (!line) continue
      const row = JSON.parse(line)
      // The index stores one or more QIDs per artist; the first is the primary link.
      const qid = Array.isArray(row.wd) ? row.wd[0] : row.wd
      if (qid && (!wanted || wanted.has(row.a))) ids.set(row.a, qid)
    }
  }
  return ids
}
