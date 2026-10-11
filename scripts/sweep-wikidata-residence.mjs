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
 *   node scripts/sweep-wikidata-residence.mjs --derive   # re-derive from the checkpoint only
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { countryNames, gapFillArtists, mbHomes, mbWikidataIds, readJson } from './lib/presenceSources.mjs'

const WORK_PATH = 'data/wikidata-residence-work.json'
const OUT_PATH = 'data/wikidata-residence.json'
const BATCH = 75
const PACE_MS = 1500
const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'EarClef/1.0 (Artist Chapters sweep; https://earclef.com)'
const DERIVE_ONLY = process.argv.includes('--derive')

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
  writeFileSync(`${WORK_PATH}.tmp`, JSON.stringify(work))
  renameSync(`${WORK_PATH}.tmp`, WORK_PATH)
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
    const rows = work.results[target.qid]
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
      const place = row.isSettlement && !row.isCountry ? row.placeLabel : null
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
        evidence: `Wikidata ${target.qid} ${label}: ${row.placeLabel ?? row.place} (${row.place})${when ? `, ${when}` : ''}`,
      })
    }
  }
  return { chapters, stats }
}

async function main() {
  const names = countryNames()
  let work = existsSync(WORK_PATH) ? readJson(WORK_PATH) : null
  if (!work || DERIVE_ONLY) {
    if (!work) {
      const all = targets()
      console.log(`${all.length} artists with a Wikidata item (${all.filter((t) => t.key.includes('-')).length} MusicBrainz, ${all.filter((t) => !t.key.includes('-')).length} gap-fill)`)
      work = { startedAt: new Date().toISOString(), targets: all, done: 0, results: {} }
      saveWork(work)
    }
  }
  if (!DERIVE_ONLY) {
    const qids = [...new Set(work.targets.map((t) => t.qid))]
    console.log(`${qids.length} distinct items · ${work.done} already swept`)
    for (let index = work.done; index < qids.length; index += BATCH) {
      const batch = qids.slice(index, index + BATCH)
      const rows = await fetchBatch(batch)
      const results = { ...work.results }
      for (const qid of batch) results[qid] = results[qid] ?? []
      for (const row of rows) results[row.qid] = [...(results[row.qid] ?? []), row]
      work = { ...work, done: Math.min(index + BATCH, qids.length), results }
      saveWork(work)
      if ((index / BATCH) % 20 === 0) {
        const withAny = Object.values(results).filter((list) => list.length > 0).length
        console.log(`  ${work.done.toLocaleString()} / ${qids.length.toLocaleString()} swept · ${withAny.toLocaleString()} with a residence or work location`)
      }
      await new Promise((resolve) => setTimeout(resolve, PACE_MS))
    }
  }
  const { chapters, stats } = derive(work, names)
  writeFileSync(OUT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), targets: work.targets.length, stats, chapters }, null, 1)}\n`)
  console.log('derived:', stats)
  console.log(`→ ${OUT_PATH} (${chapters.length} chapters, ${stats.dated} dated)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
