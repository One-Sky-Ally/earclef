#!/usr/bin/env node
/**
 * Artist Chapters — build lib/explore/presence-edges.json, the presence
 * model's edges (owner-approved Oct 11, 2026): for each artist, the
 * OTHER places their music happened, with the dates a source gives.
 * The artist's own pool entry is never touched; a chapter only adds.
 *
 * Sources, each its own pass (all local, id-keyed, no name matching):
 *
 *   keep-notes      the owner's Aug 2026 "metropole-residence" rulings on
 *                   gap-fill entries: "MB <mbid> area=<Country> recorded as
 *                   residence-not-origin" → an UNDATED based chapter in that
 *                   country (the note names the place, never the years).
 *   corrections     lib/explore/origin-corrections.json: the 56 artists
 *                   shown under their begin-area country instead of their
 *                   MusicBrainz area — owner ruling Oct 11: origin PLUS a
 *                   chapter, not a move. The area country becomes an
 *                   undated based chapter.
 *   recording       lib/explore/on-this-day/places.json joined to the
 *                   On-this-day items: MusicBrainz "recorded at/in" on a
 *                   song, in a country other than the artist's own →
 *                   a `recorded` chapter per city, spanning the songs'
 *                   years. A line only, never a placement (owner ruling).
 *   rulings         data/presence-chapter-rulings.json: hand-read cases
 *                   with the statement quoted (Naghma, Los Nickelos …).
 *   wikidata        data/wikidata-residence.json (phase 4 sweep output,
 *                   when present): P551 residence / P937 work location
 *                   with start/end qualifiers → dated based chapters.
 *
 * Standing rules: nothing fuzzy (every join is by id), nothing invented
 * (years only as a source states them), nothing deleted.
 *
 *   node scripts/build-presence-edges.mjs            # write
 *   node scripts/build-presence-edges.mjs --dry-run  # report only
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CLAIMED_PLACES } from '../lib/explore/claimedPlaces.ts'

const OUT_PATH = 'lib/explore/presence-edges.json'
const POOL_PATH = 'lib/explore/extra-artists.json'
const CORRECTIONS_PATH = 'lib/explore/origin-corrections.json'
const PLACES_PATH = 'lib/explore/on-this-day/places.json'
const ON_THIS_DAY_DIR = 'lib/explore/on-this-day'
const COUNTRY_DIR = 'lib/explore/country-artists'
const RULINGS_PATH = 'data/presence-chapter-rulings.json'
const WIKIDATA_PATH = 'data/wikidata-residence.json'
const DRY_RUN = process.argv.includes('--dry-run')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** code → name, from the committed country files (the globe's own names). */
function countryNames() {
  const names = new Map()
  for (const file of readdirSync(COUNTRY_DIR)) {
    if (!file.endsWith('.json')) continue
    const code = file.replace('.json', '')
    const stored = readJson(join(COUNTRY_DIR, file))
    if (stored.name) names.set(code, stored.name)
  }
  // Claimed places live on the globe under their own ids (lib/explore/claimedPlaces.ts).
  for (const place of CLAIMED_PLACES) names.set(place.id, place.name)
  return names
}

/** The verified-play key the server uses for a gap-fill entry (extraArtistsServer.ts, ported exactly). */
function extraPlayKey(artist) {
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

/** Accumulates chapters per artist; same kind+country+place merges, a dated reading wins over an undated one. */
class Edges {
  constructor(names) {
    this.names = names
    this.artists = new Map()
    this.report = []
  }

  artist(key, { name, home, playKey, tags }) {
    const homeName = this.names.get(home)
    if (!homeName) {
      // An artist whose own entry is filed where the globe has no panel
      // (Wing → HK) renders nowhere, so a chapter has no row to sit on.
      this.report.push(`skip ${name}: home ${home} is not on the globe`)
      return null
    }
    const existing = this.artists.get(key)
    if (existing) return existing
    const created = { name, home, homeName, ...(playKey ? { playKey } : {}), ...(tags ? { tags } : {}), chapters: [] }
    this.artists.set(key, created)
    return created
  }

  add(key, who, chapter) {
    if (chapter.country === who.home) return false
    const countryName = this.names.get(chapter.country)
    if (!countryName) {
      this.report.push(`skip ${who.name}: ${chapter.country} is not on the globe (${chapter.source})`)
      return false
    }
    const artist = this.artist(key, who)
    if (!artist) return false
    const same = artist.chapters.find(
      (held) => held.kind === chapter.kind && held.country === chapter.country && (held.place ?? null) === (chapter.place ?? null),
    )
    const next = { ...chapter, countryName }
    if (!same) {
      artist.chapters.push(next)
      return true
    }
    const dated = (entry) => entry.from != null || entry.to != null
    const merged = {
      ...same,
      ...(dated(next) && !dated(same) ? { from: next.from ?? null, to: next.to ?? null } : {}),
      source: [...new Set([...same.source.split('+'), next.source])].join('+'),
      evidence: [same.evidence, next.evidence].filter(Boolean).join(' | '),
    }
    artist.chapters = artist.chapters.map((entry) => (entry === same ? merged : entry))
    return true
  }
}

/**
 * MusicBrainz area names the notes quote that differ from the globe's
 * own name for the same country — exact strings, nothing fuzzy.
 */
const MB_AREA_ALIASES = new Map([['United States', 'US']])

/** Pass 1: the owner's metropole-residence keep-notes. */
function keepNotes(edges, pool, codeByName) {
  const RULED = /MB ([0-9a-f-]{36}) area=([^;]+?) recorded as residence-not-origin/
  let written = 0
  for (const [code, list] of Object.entries(pool.countries)) {
    for (const entry of list) {
      if (!entry.note || entry.presence === 'archive') continue
      const match = RULED.exec(entry.note)
      if (!match) {
        if (/residence/i.test(entry.note)) edges.report.push(`unmatched residence note [${code}] ${entry.name}: ${entry.note.slice(0, 140)}`)
        continue
      }
      const areaName = match[2].trim()
      const country = MB_AREA_ALIASES.get(areaName) ?? codeByName.get(areaName)
      if (!country) {
        edges.report.push(`skip ${entry.name}: "${areaName}" is not a globe country (keep-note)`)
        continue
      }
      const key = extraPlayKey(entry)
      const who = { name: entry.name, home: code, playKey: key }
      if (edges.add(key, who, { kind: 'based', country, source: 'keep-note', evidence: entry.note })) written++
    }
  }
  return written
}

/** Pass 2: origin corrections — origin plus a chapter, not a move. */
function corrections(edges) {
  const moves = readJson(CORRECTIONS_PATH).moves ?? {}
  let written = 0
  for (const [mbid, move] of Object.entries(moves)) {
    const who = { name: move.name, home: move.to, tags: move.tags ?? [] }
    const evidence = `MusicBrainz area ${move.from}; begin-area ${move.beginArea ?? '—'} → ${move.to}; ${move.why ?? ''}`.trim()
    if (edges.add(mbid, who, { kind: 'based', country: move.from, source: 'origin-correction', evidence })) written++
  }
  return written
}

/** The globe's own country for each MusicBrainz artist (corrections applied), with name and tags. */
function mbHomes() {
  const moves = readJson(CORRECTIONS_PATH).moves ?? {}
  const homes = new Map()
  for (const file of readdirSync(COUNTRY_DIR)) {
    if (!file.endsWith('.json')) continue
    const code = file.replace('.json', '')
    for (const artist of readJson(join(COUNTRY_DIR, file)).artists ?? []) {
      homes.set(artist.id, { name: artist.name, home: moves[artist.id]?.to ?? code, tags: artist.t ?? [] })
    }
  }
  return homes
}

/** Pass 3: verified recording places abroad → recorded lines. */
function recordingPlaces(edges, homes) {
  if (!existsSync(PLACES_PATH)) return 0
  const groups = readJson(PLACES_PATH).groups ?? {}
  const sessions = new Map() // mbid → Map(country|city → {min,max,count})
  for (const file of readdirSync(ON_THIS_DAY_DIR)) {
    if (!/^\d\d\.json$/.test(file)) continue
    for (const day of Object.values(readJson(join(ON_THIS_DAY_DIR, file)).days ?? {})) {
      for (const item of day.items ?? []) {
        const group = item.rg ? groups[item.rg] : null
        if (!group || !item.a) continue
        const stored = group.tracks ? Object.values(group.tracks)[0] : group.release
        if (!stored) continue
        const who = homes.get(item.a)
        if (!who || stored.country === who.home) continue
        const byPlace = sessions.get(item.a) ?? new Map()
        const placeKey = `${stored.country}|${stored.city ?? ''}`
        const held = byPlace.get(placeKey) ?? { country: stored.country, city: stored.city ?? null, min: item.y, max: item.y, count: 0 }
        byPlace.set(placeKey, { ...held, min: Math.min(held.min, item.y), max: Math.max(held.max, item.y), count: held.count + 1 })
        sessions.set(item.a, byPlace)
      }
    }
  }
  let written = 0
  for (const [mbid, byPlace] of sessions) {
    const who = homes.get(mbid)
    for (const session of [...byPlace.values()].sort((a, b) => a.min - b.min)) {
      const chapter = {
        kind: 'recorded',
        country: session.country,
        ...(session.city ? { place: session.city } : {}),
        from: session.min,
        to: session.max,
        source: 'recording-place',
        evidence: `MusicBrainz recorded-at/in on ${session.count} song${session.count === 1 ? '' : 's'} (On this day)`,
      }
      if (edges.add(mbid, who, chapter)) written++
    }
  }
  return written
}

/** Pass 4: hand-read rulings, each with its statement quoted. */
function rulings(edges, pool, homes) {
  if (!existsSync(RULINGS_PATH)) return 0
  let written = 0
  for (const ruling of readJson(RULINGS_PATH).cases ?? []) {
    const who = ruling.key.includes('-')
      ? homes.get(ruling.key)
      : (() => {
          const entry = (pool.countries[ruling.home] ?? []).find((candidate) => extraPlayKey(candidate) === ruling.key)
          return entry ? { name: entry.name, home: ruling.home, playKey: ruling.key } : null
        })()
    if (!who) throw new Error(`ruling ${ruling.key} (${ruling.name}): no pool entry carries that key`)
    if (who.home !== ruling.home) throw new Error(`ruling ${ruling.key}: home ${ruling.home} but the entry sits in ${who.home}`)
    for (const chapter of ruling.chapters) {
      if (edges.add(ruling.key, who, { ...chapter, source: 'owner-ruling', evidence: ruling.evidence })) written++
    }
  }
  return written
}

/** Pass 5: the Wikidata residence / work-location sweep, when it has run. */
function wikidata(edges, pool, homes) {
  if (!existsSync(WIKIDATA_PATH)) return 0
  const sweep = readJson(WIKIDATA_PATH)
  let written = 0
  for (const row of sweep.chapters ?? []) {
    const who = row.key.includes('-')
      ? homes.get(row.key)
      : (() => {
          const entry = (pool.countries[row.home] ?? []).find((candidate) => extraPlayKey(candidate) === row.key)
          return entry ? { name: entry.name, home: row.home, playKey: row.key } : null
        })()
    if (!who) continue
    const chapter = {
      kind: 'based',
      country: row.country,
      ...(row.place ? { place: row.place } : {}),
      from: row.from ?? null,
      to: row.to ?? null,
      source: 'wikidata',
      evidence: row.evidence,
    }
    if (edges.add(row.key, who, chapter)) written++
  }
  return written
}

function main() {
  const names = countryNames()
  const codeByName = new Map([...names].map(([code, name]) => [name, code]))
  const pool = readJson(POOL_PATH)
  const homes = mbHomes()
  const edges = new Edges(names)

  const counts = {
    'keep-notes': keepNotes(edges, pool, codeByName),
    corrections: corrections(edges),
    recording: recordingPlaces(edges, homes),
    rulings: rulings(edges, pool, homes),
    wikidata: wikidata(edges, pool, homes),
  }

  const artists = Object.fromEntries([...edges.artists].sort(([a], [b]) => a.localeCompare(b)))
  const based = Object.values(artists).flatMap((artist) => artist.chapters.filter((chapter) => chapter.kind === 'based'))
  const dated = based.filter((chapter) => chapter.from != null)
  const recorded = Object.values(artists).flatMap((artist) => artist.chapters.filter((chapter) => chapter.kind === 'recorded'))

  for (const line of edges.report) console.log(`  ${line}`)
  console.log('chapters written per pass:', counts)
  console.log(
    `${Object.keys(artists).length} artists with chapters · based ${based.length} (dated ${dated.length} — these place the artist in a second panel) · recorded ${recorded.length} (lines only)`,
  )
  if (DRY_RUN) {
    console.log('dry run — nothing written')
    return
  }
  writeFileSync(OUT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), artists }, null, 1)}\n`)
  console.log(`→ ${OUT_PATH}`)
}

main()
