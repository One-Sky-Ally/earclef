#!/usr/bin/env node
/**
 * Artist Chapters phase 4 — the Wikidata residence / work-location
 * sweep. For every artist the globe files who has a Wikidata item
 * (MusicBrainz artists through the local URL-relation index, gap-fill
 * entries through their wikidataId), read P551 (residence) and P937
 * (work location) with their start (P580) and end (P582) qualifiers,
 * and write the ones in ANOTHER country as based chapters, dated
 * exactly as Wikidata dates them:
 *
 *   precision year or finer → the year; precision decade → "1980s";
 *   coarser (century) → no date (the chapter is a line only).
 *
 * The place: the statement's own value when it is a human settlement
 * (city, town, village …); the country alone when the value is the
 * country or something else (a house, a district, a region) — nothing
 * is guessed up or down the hierarchy. The country is the value's P17
 * resolved to its ISO code; a value with no country is skipped.
 *
 * Checkpointed per batch to data/wikidata-residence-work.json
 * (gitignored) and resumable; ~75 items per query, paced. Output:
 * data/wikidata-residence.json, which scripts/build-presence-edges.mjs
 * reads as its wikidata pass.
 *
 *   node scripts/sweep-wikidata-residence.mjs            # run / resume
 *   node scripts/sweep-wikidata-residence.mjs --cities   # stage 2: districts → their city (then --derive)
 *   node scripts/sweep-wikidata-residence.mjs --derive   # re-derive from the checkpoint only
 */
import { existsSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import { countryNames, gapFillArtists, mbHomes, mbWikidataIds, readJson } from './lib/presenceSources.mjs'

const WORK_PATH = 'data/wikidata-residence-work.json'
const OUT_PATH = 'data/wikidata-residence.json'
const BATCH = 75
const PACE_MS = 1500
const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'EarClef/1.0 (Artist Chapters sweep; https://earclef.com)'
const DERIVE_ONLY = process.argv.includes('--derive')
const CITIES_ONLY = process.argv.includes('--cities')
/** Shards: --from/--to bound the item indexes this worker sweeps; --work names its checkpoint. --derive merges every data/wikidata-residence-work*.json. */
const argValue = (flag) => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}
const FROM = Number(argValue('--from') ?? 0)
const TO = argValue('--to') ? Number(argValue('--to')) : Infinity
const WORK = argValue('--work') ?? WORK_PATH

function targets() {
  const homes = mbHomes()
  const qids = mbWikidataIds(new Set(homes.keys()))
  const rows = []
  for (const [mbid, qid] of qids) {
    const who = homes.get(mbid)
    if (who && /^Q\d+$/.test(qid)) rows.push({ key: mbid, qid, home: who.home, name: who.name })
  }
  for (const artist of gapFillArtists()) {
    if (artist.entry.presence === 'archive' || !artist.wikidataId || !/^Q\d+$/.test(artist.wikidataId)) continue
    rows.push({ key: artist.key, qid: artist.wikidataId, home: artist.home, name: artist.name })
  }
  return rows
}

function query(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(' ')
  return `SELECT ?item ?prop ?place ?placeLabel ?iso ?isCountry ?isSettlement ?start ?startPrec ?end ?endPrec WHERE {
  VALUES ?item { ${values} }
  VALUES (?prop ?ps) { (p:P551 ps:P551) (p:P937 ps:P937) }
  ?item ?prop ?st . ?st ?ps ?place .
  OPTIONAL { ?place wdt:P17 ?country . ?country wdt:P297 ?iso }
  BIND(EXISTS { ?place wdt:P297 [] } AS ?isCountry)
  BIND(EXISTS { ?place wdt:P31/wdt:P279* wd:Q486972 } AS ?isSettlement)
  OPTIONAL { ?st pqv:P580 ?sv . ?sv wikibase:timeValue ?start ; wikibase:timePrecision ?startPrec }
  OPTIONAL { ?st pqv:P582 ?ev . ?ev wikibase:timeValue ?end ; wikibase:timePrecision ?endPrec }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`
}

async function fetchBatch(qids) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query(qids))}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(90_000),
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const json = await res.json()
      return json.results.bindings.map((b) => ({
        qid: b.item.value.split('/').pop(),
        prop: b.prop.value.endsWith('P551') ? 'P551' : 'P937',
        place: b.place.value.split('/').pop(),
        placeLabel: b.placeLabel?.value ?? null,
        iso: b.iso?.value ?? null,
        isCountry: b.isCountry?.value === 'true',
        isSettlement: b.isSettlement?.value === 'true',
        start: b.start?.value ?? null,
        startPrec: b.startPrec ? Number(b.startPrec.value) : null,
        end: b.end?.value ?? null,
        endPrec: b.endPrec ? Number(b.endPrec.value) : null,
      }))
    } catch (error) {
      const wait = 5_000 * attempt
      console.warn(`  batch failed (${error.message}) — retry ${attempt}/5 in ${wait / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw new Error('batch failed 5 times — stopping (resume later)')
}

function saveWork(work) {
  writeFileSync(`${WORK}.tmp`, JSON.stringify(work))
  renameSync(`${WORK}.tmp`, WORK)
}

/** Every shard's results, merged (a shard's rows for an item win over an empty entry). */
function mergedResults() {
  const results = {}
  for (const file of readdirSync('data')) {
    if (!/^wikidata-residence-work.*\.json$/.test(file)) continue
    const shard = readJson(`data/${file}`)
    for (const [qid, rows] of Object.entries(shard.results ?? {})) {
      if (!results[qid] || results[qid].length === 0) results[qid] = rows
    }
  }
  return results
}

/**
 * Stage 2 (--cities): a residence or work location that is a settlement
 * INSIDE a city (a borough, a district, a neighbourhood) names the city
 * (owner, Oct 11: "Prenzlauer Berg" → Berlin). The nearest item up the
 * value's P131 chain — itself first — that is an instance of a city
 * class (P31/P279* Q515) wins; a settlement with no city above it (a
 * village, a town) keeps its own name. Cached in the main checkpoint.
 */
function cityQuery(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(' ')
  return `SELECT ?place ?a1 ?a2 ?a3 ?a4 ?c0 ?c1 ?c2 ?c3 ?c4 ?a1Label ?a2Label ?a3Label ?a4Label ?placeLabel WHERE {
  VALUES ?place { ${values} }
  BIND(EXISTS { ?place wdt:P31/wdt:P279* wd:Q515 } AS ?c0)
  OPTIONAL { ?place wdt:P131 ?a1 . BIND(EXISTS { ?a1 wdt:P31/wdt:P279* wd:Q515 } AS ?c1)
    OPTIONAL { ?a1 wdt:P131 ?a2 . BIND(EXISTS { ?a2 wdt:P31/wdt:P279* wd:Q515 } AS ?c2)
      OPTIONAL { ?a2 wdt:P131 ?a3 . BIND(EXISTS { ?a3 wdt:P31/wdt:P279* wd:Q515 } AS ?c3)
        OPTIONAL { ?a3 wdt:P131 ?a4 . BIND(EXISTS { ?a4 wdt:P31/wdt:P279* wd:Q515 } AS ?c4) } } } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`
}

async function fetchCities(qids) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(cityQuery(qids))}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const best = {}
      for (const b of json.results.bindings) {
        const place = b.place.value.split('/').pop()
        const hops = [
          ['c0', 'place', 'placeLabel'],
          ['c1', 'a1', 'a1Label'],
          ['c2', 'a2', 'a2Label'],
          ['c3', 'a3', 'a3Label'],
          ['c4', 'a4', 'a4Label'],
        ]
        for (let depth = 0; depth < hops.length; depth++) {
          const [flag, item, label] = hops[depth]
          if (b[flag]?.value !== 'true' || !b[item]) continue
          const candidate = { qid: b[item].value.split('/').pop(), label: b[label]?.value ?? null, depth }
          // Nearest city wins; equal depth → alphabetical, for determinism.
          if (!best[place] || candidate.depth < best[place].depth || (candidate.depth === best[place].depth && (candidate.label ?? '') < (best[place].label ?? ''))) best[place] = candidate
          break
        }
      }
      return best
    } catch (error) {
      const wait = 5_000 * attempt
      console.warn(`  cities batch failed (${error.message}) — retry ${attempt}/5 in ${wait / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw new Error('cities batch failed 5 times')
}

async function resolveCities(work, names) {
  const results = mergedResults()
  const homeOf = new Map(work.targets.map((t) => [String(t.qid), t.home]))
  const wanted = new Set()
  for (const [qid, rows] of Object.entries(results)) {
    for (const row of rows) {
      if (row.isSettlement && !row.isCountry && row.iso && row.iso !== homeOf.get(qid) && names.has(row.iso)) wanted.add(row.place)
    }
  }
  const cities = { ...(work.cities ?? {}) }
  const todo = [...wanted].filter((qid) => !(qid in cities))
  console.log(`${wanted.size} settlement places in chapters abroad · ${todo.length} to resolve`)
  for (let index = 0; index < todo.length; index += BATCH) {
    const batch = todo.slice(index, index + BATCH)
    const found = await fetchCities(batch)
    for (const qid of batch) cities[qid] = found[qid] ? { qid: found[qid].qid, label: found[qid].label } : null
    await new Promise((resolve) => setTimeout(resolve, PACE_MS))
  }
  return { ...work, cities }
}

/** A Wikidata time value as a chapter year: exact for year precision or finer, a decade reading for decade precision, nothing coarser. */
function chapterYear(value, precision) {
  if (!value || precision == null) return null
  const year = Number(value.slice(0, value.indexOf('-', 1)))
  if (!Number.isInteger(year)) return null
  if (precision >= 9) return year
  if (precision === 8) return `${Math.floor(year / 10) * 10}s`
  return null
}

function derive(work, names) {
  const chapters = []
  const stats = { withStatements: 0, rows: 0, abroad: 0, dated: 0, noCountry: 0, notOnGlobe: 0, homeOnly: 0 }
  const seen = new Set()
  for (const target of work.targets) {
    const rows = work.results[String(target.qid)]
    if (!rows || rows.length === 0) continue
    stats.withStatements++
    for (const row of rows) {
      stats.rows++
      if (!row.iso) {
        stats.noCountry++
        continue
      }
      if (row.iso === target.home) {
        stats.homeOnly++
        continue
      }
      if (!names.has(row.iso)) {
        stats.notOnGlobe++
        continue
      }
      // The settlement's own name, or the city it sits inside when stage 2 found one.
      const city = row.isSettlement && !row.isCountry ? (work.cities?.[row.place] ?? null) : null
      const place = row.isSettlement && !row.isCountry ? (city?.label ?? row.placeLabel) : null
      const from = chapterYear(row.start, row.startPrec)
      const to = chapterYear(row.end, row.endPrec)
      const dedupe = `${target.key}|${row.iso}|${place ?? ''}|${from ?? ''}|${to ?? ''}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      stats.abroad++
      if (from != null) stats.dated++
      const label = row.prop === 'P551' ? 'residence (P551)' : 'work location (P937)'
      const when = [row.start ? `start ${row.start.slice(0, 10)}` : null, row.end ? `end ${row.end.slice(0, 10)}` : null].filter(Boolean).join(', ')
      chapters.push({
        key: target.key,
        home: target.home,
        country: row.iso,
        ...(place ? { place } : {}),
        ...(from != null ? { from } : {}),
        ...(to != null ? { to } : {}),
        evidence: `Wikidata ${target.qid} ${label}: ${row.placeLabel ?? row.place} (${row.place})${city && city.qid !== row.place ? `, in ${city.label} (${city.qid})` : ''}${when ? `, ${when}` : ''}`,
      })
    }
  }
  return { chapters, stats }
}

async function main() {
  const names = countryNames()
  // The target list lives in the main checkpoint; a shard copies it so every worker indexes the same list.
  const base = existsSync(WORK_PATH) ? readJson(WORK_PATH) : null
  let work = existsSync(WORK) ? readJson(WORK) : null
  if (!work) {
    const all = base?.targets ?? targets()
    if (!base) console.log(`${all.length} artists with a Wikidata item (${all.filter((t) => t.key.includes('-')).length} MusicBrainz, ${all.filter((t) => !t.key.includes('-')).length} gap-fill)`)
    work = { startedAt: new Date().toISOString(), targets: all, done: FROM, results: {} }
    saveWork(work)
  }
  if (CITIES_ONLY) {
    work = await resolveCities(work, names)
    saveWork(work)
  }
  if (!DERIVE_ONLY && !CITIES_ONLY) {
    // Index-stable (no dedup): shards must agree on positions.
    const qids = work.targets.map((t) => String(t.qid))
    const stop = Math.min(TO, qids.length)
    console.log(`${qids.length} items · this worker sweeps ${Math.max(work.done, FROM)} → ${stop} (${work.done} already done)`)
    for (let index = Math.max(work.done, FROM); index < stop; index += BATCH) {
      const batch = [...new Set(qids.slice(index, Math.min(index + BATCH, stop)))]
      const rows = await fetchBatch(batch)
      const results = { ...work.results }
      for (const qid of batch) results[qid] = results[qid] ?? []
      for (const row of rows) results[row.qid] = [...(results[row.qid] ?? []), row]
      work = { ...work, done: Math.min(index + BATCH, stop), results }
      saveWork(work)
      if ((index / BATCH) % 20 === 0) {
        const withAny = Object.values(results).filter((list) => list.length > 0).length
        console.log(`  ${work.done.toLocaleString()} / ${qids.length.toLocaleString()} swept · ${withAny.toLocaleString()} with a residence or work location`)
      }
      await new Promise((resolve) => setTimeout(resolve, PACE_MS))
    }
  }
  const main = existsSync(WORK_PATH) ? readJson(WORK_PATH) : work
  const { chapters, stats } = derive({ ...work, cities: main.cities ?? work.cities, results: mergedResults() }, names)
  writeFileSync(OUT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), targets: work.targets.length, stats, chapters }, null, 1)}\n`)
  console.log('derived:', stats)
  console.log(`→ ${OUT_PATH} (${chapters.length} chapters, ${stats.dated} dated)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
