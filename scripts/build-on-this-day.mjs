/**
 * "ON THIS DAY" dataset (owner, Oct 10 2026): music released on a
 * calendar day in past years, from any country that has an exact release
 * date. ONLY exact dates (scripts/lib/onThisDay.mjs exactDay: a real day,
 * never a year- or month-only date, never Jan 1, never the future).
 *
 * WHAT COUNTS, from local dumps only (nothing fetched):
 *   · MusicBrainz release groups by the artists the site already shows
 *     (lib/explore/country-artists): original albums, singles and EPs
 *     (no compilation/live/remix secondary type) dated by the group's
 *     FIRST release date. A group whose era-dating correction
 *     (lib/explore/rg-dating) says its music is from another year is left
 *     out — its exact date belongs to a reissue.
 *   · Discogs releases by the site's gap-fill artists (credited as main
 *     artist), ORIGINALS only: a masterless release, or the earliest-year,
 *     most precise release of its master. Compilations left out.
 * Country = the artist's country on the site (panel or gap-fill pool).
 *
 * WHAT A DAY HOLDS (scripts/lib/onThisDay.mjs selectDay): every exact
 * date is COUNTED (per decade, per country); a decade-balanced,
 * country-diverse selection is LISTED, because the 2010s and 2020s hold
 * almost every exact date and would otherwise bury everything older.
 *
 * Resumable: the Discogs pass (~19M rows) is cached in
 * data/on-this-day-work.json (gitignored); --fresh redoes it.
 *
 *   node scripts/build-on-this-day.mjs [--fresh]
 * Output: lib/explore/on-this-day/{01..12}.json + index.json
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGunzip } from 'node:zlib'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'
import { correctedAway, exactDay, isOriginalMbGroup, selectDay } from './lib/onThisDay.mjs'
import { globePlace } from './lib/onThisDayGlobePlace.mjs'

const COUNTRY_DIR = 'lib/explore/country-artists'
const DATING_DIR = 'lib/explore/rg-dating'
const POOL_PATH = 'lib/explore/extra-artists.json'
const MB_RG_DIR = 'data/mb-dump/rg-by-artist'
const DG_DIR = 'data/discogs-dump/index/releases-by-country'
const WORK_PATH = 'data/on-this-day-work.json'
/** Bumped when the cached Discogs items gain a field (2: the globe place `h`). */
const WORK_VERSION = 2
const OUT_DIR = 'lib/explore/on-this-day'
const FRESH = process.argv.includes('--fresh')
/** Listed per decade on a day, dealt round-robin across countries. */
const PER_DECADE = 12
/** Discogs "Various" (the dump's own id). */
const VARIOUS_ID = 194

const today = new Date().toISOString().slice(0, 10)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Lines split on '\n' only, streamed (readline also splits on a lone '\r'). */
async function* lines(path) {
  const input = path.endsWith('.gz') ? createReadStream(path).pipe(createGunzip()) : createReadStream(path)
  input.setEncoding('utf8')
  let pending = ''
  for await (const chunk of input) {
    const parts = (pending + chunk).split('\n')
    pending = parts.pop()
    yield* parts
  }
  if (pending) yield pending
}

const yearOf = (value) => {
  const year = Number(String(value ?? '').slice(0, 4))
  return Number.isInteger(year) && year > 0 ? year : null
}

/**
 * Every place the GLOBE puts each MusicBrainz artist, with the dated span
 * it era-gates them by — the same sources the panels serve from: the
 * country files with origin corrections applied (lib/explore/
 * originCorrections.ts moves an artist out of `from` into `to`), the
 * historical-area roster, claimed places and self-filed entries.
 * mbid → [{ place, from, to }]
 */
function mbPlacements(countryFiles) {
  const moves = readJson('lib/explore/origin-corrections.json').moves ?? {}
  const placements = new Map()
  const add = (mbid, place, from, to) => {
    if (!mbid || !place) return
    if (!placements.has(mbid)) placements.set(mbid, [])
    placements.get(mbid).push({ place, from: yearOf(from), to: yearOf(to) })
  }
  for (const [code, artists] of countryFiles) {
    for (const artist of artists) add(artist.id, moves[artist.id]?.to ?? code, artist.cs, artist.end)
  }
  for (const [code, artists] of Object.entries(readJson('lib/explore/historical-area-artists.json').countries ?? {})) {
    for (const artist of artists) add(artist.mbid, code, artist.lifeBegin, artist.lifeEnd)
  }
  for (const file of readdirSync('lib/explore/claimed-places').filter((name) => name.endsWith('.json'))) {
    const claimed = readJson(join('lib/explore/claimed-places', file))
    for (const artist of claimed.artists ?? []) add(artist.mbid, claimed.placeId, artist.lifeBegin, artist.lifeEnd)
  }
  for (const artist of readJson('lib/explore/self-filed.json').artists ?? []) {
    add(artist.mbid, artist.country, artist.cs, artist.end)
  }
  return { placements, moves }
}

/** Gap-fill artist (Discogs id) → every pool listing them, dated by the pool's years. */
function poolPlacements(pool) {
  const placements = new Map()
  for (const [code, list] of Object.entries(pool.countries)) {
    for (const entry of list) {
      if (entry.discogsArtistId == null) continue
      if (!placements.has(entry.discogsArtistId)) placements.set(entry.discogsArtistId, [])
      placements.get(entry.discogsArtistId).push({ place: code, from: yearOf(entry.firstYear), to: yearOf(entry.lastYear) })
    }
  }
  return placements
}

/** Country code → display name, from the files the site already shows. */
const countryNames = Object.fromEntries(Object.entries(COUNTRIES).map(([code, entry]) => [code, entry.name]))

function siteArtists() {
  const byId = new Map()
  const countryFiles = []
  for (const file of readdirSync(COUNTRY_DIR).filter((name) => name.endsWith('.json'))) {
    const code = file.replace('.json', '')
    const stored = readJson(join(COUNTRY_DIR, file))
    if (stored.name) countryNames[code] = stored.name
    countryFiles.push([code, stored.artists ?? []])
    for (const artist of stored.artists ?? []) {
      // `g`: the artist's raw tags — canonicalized when served, as the panels do.
      if (!byId.has(artist.id)) byId.set(artist.id, { c: code, n: artist.name, w: artist.w ?? 0, g: (artist.t ?? []).slice(0, 8) })
    }
  }
  // The globe's placement: an origin-corrected artist is shown under `to`.
  const { placements, moves } = mbPlacements(countryFiles)
  for (const [id, artist] of byId) if (moves[id]?.to) byId.set(id, { ...artist, c: moves[id].to })
  return { byId, placements }
}

const datingShards = new Map()
function datingFor(mbid) {
  const prefix = mbid.slice(0, 2)
  if (!datingShards.has(prefix)) {
    const path = join(DATING_DIR, `${prefix}.json`)
    datingShards.set(prefix, existsSync(path) ? readJson(path) : {})
  }
  return datingShards.get(prefix)[mbid] ?? null
}

async function musicBrainzItems(artists, placements) {
  const byGroup = new Map()
  let rows = 0
  for (const file of readdirSync(MB_RG_DIR).filter((name) => name.endsWith('.jsonl')).sort()) {
    for await (const line of lines(join(MB_RG_DIR, file))) {
      if (!line) continue
      rows++
      const row = JSON.parse(line)
      const artist = artists.get(row.a)
      if (!artist || !isOriginalMbGroup(row)) continue
      const day = exactDay(row.d, today)
      if (!day || correctedAway(row, day.year, datingFor(row.a))) continue
      const held = byGroup.get(row.i)
      // A group credited to several site artists is listed once, under the
      // most-followed of them.
      if (held && held.w >= artist.w) continue
      // `rg`: the release group — the key the recording-place pass joins on.
      // `h`: where the globe places this artist for this year — the
      // fallback place when no recording place is known (absent when the
      // globe has them in several places with no dated way to choose).
      const home = globePlace(placements.get(row.a) ?? [], day.year)
      byGroup.set(row.i, { md: day.monthDay, y: day.year, t: row.t, k: row.p, c: artist.c, n: artist.n, w: artist.w, a: row.a, rg: row.i, g: artist.g, ...(home ? { h: home } : {}) })
    }
  }
  console.log(`MusicBrainz: ${rows.toLocaleString()} rows → ${byGroup.size.toLocaleString()} exact-dated originals`)
  return [...byGroup.values()]
}

/** "1975" < "1975-03" < "1975-03-12": the earliest year, then the most precise. */
function betterOriginal(a, b) {
  if (!a) return b
  if (!b) return a
  const yearA = a.r.slice(0, 4)
  const yearB = b.r.slice(0, 4)
  if (yearA !== yearB) return yearA < yearB ? a : b
  return b.r.length > a.r.length ? b : a
}

async function discogsItems(pool) {
  if (!FRESH && existsSync(WORK_PATH)) {
    const work = readJson(WORK_PATH)
    if (work.today === today && work.version === WORK_VERSION) {
      console.log(`Discogs: ${work.items.length} gap-fill originals from the cached pass`)
      return work.items
    }
  }
  // Gap-fill artist → the pool it is listed in (first pool wins).
  const artistPool = new Map()
  for (const [code, list] of Object.entries(pool.countries)) {
    for (const entry of list) {
      if (entry.discogsArtistId != null && !artistPool.has(entry.discogsArtistId)) {
        artistPool.set(entry.discogsArtistId, { c: code, n: entry.name, w: entry.releaseCount ?? 0, g: (entry.styles ?? []).map((style) => style.toLowerCase()).slice(0, 8) })
      }
    }
  }
  const pooled = poolPlacements(pool)
  const bestOfMaster = new Map()
  const candidates = []
  const files = readdirSync(DG_DIR).filter((name) => name.endsWith('.jsonl.gz')).sort()
  for (const [index, file] of files.entries()) {
    for await (const line of lines(join(DG_DIR, file))) {
      if (!line) continue
      const row = JSON.parse(line)
      if (!row.r) continue
      if (row.m) bestOfMaster.set(row.m, betterOriginal(bestOfMaster.get(row.m), { i: row.i, r: String(row.r) }))
      const credit = (row.a ?? []).find((artist) => artistPool.has(artist.i))
      if (!credit || (row.a ?? []).some((artist) => artist.i === VARIOUS_ID)) continue
      if ((row.fd ?? []).some((text) => /^compilation$/i.test(text))) continue
      const day = exactDay(row.r, today)
      if (!day) continue
      const artist = artistPool.get(credit.i)
      // `ga`: the credited gap-fill artist's Discogs id — the play check anchors on it.
      const home = globePlace(pooled.get(credit.i) ?? [], day.year)
      candidates.push({ md: day.monthDay, y: day.year, t: row.t, k: (row.fd ?? [])[0] ?? (row.f ?? [])[0] ?? 'Release', c: artist.c, n: artist.n, w: artist.w, g: artist.g, dg: row.i, ga: credit.i, m: row.m ?? 0, gapFill: true, ...(home ? { h: home } : {}) })
    }
    if ((index + 1) % 50 === 0) console.log(`  Discogs: ${index + 1}/${files.length} country files`)
  }
  const items = candidates
    .filter((item) => !item.m || bestOfMaster.get(item.m)?.i === item.dg)
    .map((item) => Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'm')))
  console.log(`Discogs: ${candidates.length} exact-dated gap-fill releases → ${items.length} originals`)
  writeFileSync(WORK_PATH, JSON.stringify({ today, version: WORK_VERSION, items }))
  return items
}

async function main() {
  const { byId: artists, placements } = siteArtists()
  console.log(`site artists: ${artists.size.toLocaleString()}`)
  const mb = await musicBrainzItems(artists, placements)
  const dg = await discogsItems(readJson(POOL_PATH))
  const byDay = new Map()
  for (const item of [...mb, ...dg]) {
    if (!byDay.has(item.md)) byDay.set(item.md, [])
    byDay.get(item.md).push(item)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const months = {}
  for (const [monthDay, items] of byDay) {
    const day = selectDay(items, { perDecade: PER_DECADE })
    const month = monthDay.slice(0, 2)
    months[month] ??= {}
    // Weights rank the selection; the page does not need them.
    months[month][monthDay] = {
      ...day,
      items: day.items.map((item) => Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'md' && field !== 'w'))),
    }
  }
  for (let month = 1; month <= 12; month++) {
    const key = String(month).padStart(2, '0')
    writeFileSync(join(OUT_DIR, `${key}.json`), JSON.stringify({ month: key, days: months[key] ?? {} }))
  }
  const byDecade = {}
  for (const item of [...mb, ...dg]) {
    const decade = String(Math.floor(item.y / 10) * 10)
    byDecade[decade] = (byDecade[decade] ?? 0) + 1
  }
  writeFileSync(join(OUT_DIR, 'index.json'), `${JSON.stringify({
    builtAt: new Date().toISOString(),
    datedThrough: today,
    perDecade: PER_DECADE,
    totals: { musicbrainz: mb.length, gapFill: dg.length, byDecade },
    countryNames,
  }, null, 2)}\n`)
  console.log(`Done → ${OUT_DIR}: ${mb.length + dg.length} exact-dated originals over ${byDay.size} days`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
