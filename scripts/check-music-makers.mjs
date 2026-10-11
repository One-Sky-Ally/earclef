#!/usr/bin/env node
/**
 * Artist Chapters — chapters are only for places where MUSIC was made
 * (owner, Oct 11 2026). A person on the globe whose Wikidata occupations
 * (P106) hold no music-making one — not under "musician" (Q639669),
 * and not a musical ensemble (P31 under Q2088357 / Q215380) — keeps
 * their "Recorded in" song lines but gets no based chapter. An item
 * with NO occupation at all is not judged (no evidence either way).
 *
 * Checks every artist that currently holds a based chapter
 * (lib/explore/presence-edges.json), by Wikidata id (MB artists through
 * the local URL-relation index, gap-fill through wikidataId), and writes
 * data/music-makers.json; build-presence-edges.mjs reads it. Run it
 * after a build, then build again.
 *
 *   node scripts/check-music-makers.mjs
 */
import { existsSync, writeFileSync } from 'node:fs'
import { gapFillArtists, mbWikidataIds, readJson } from './lib/presenceSources.mjs'

const EDGES_PATH = 'lib/explore/presence-edges.json'
const OUT_PATH = 'data/music-makers.json'
const BATCH = 75
const PACE_MS = 1500
const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'EarClef/1.0 (Artist Chapters occupation check; https://earclef.com)'

function query(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(' ')
  return `SELECT ?item ?musician ?ensemble ?hasOccupation (GROUP_CONCAT(DISTINCT ?occLabel; separator=" / ") AS ?occupations) WHERE {
  VALUES ?item { ${values} }
  BIND(EXISTS { ?item wdt:P106/wdt:P279* wd:Q639669 } AS ?musician)
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:Q2088357 } || EXISTS { ?item wdt:P31/wdt:P279* wd:Q215380 } AS ?ensemble)
  BIND(EXISTS { ?item wdt:P106 [] } AS ?hasOccupation)
  OPTIONAL { ?item wdt:P106 ?occ . ?occ rdfs:label ?occLabel FILTER(LANG(?occLabel) = "en") }
} GROUP BY ?item ?musician ?ensemble ?hasOccupation`
}

async function fetchBatch(qids) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query(qids))}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      return json.results.bindings.map((b) => ({
        qid: b.item.value.split('/').pop(),
        musician: b.musician?.value === 'true',
        ensemble: b.ensemble?.value === 'true',
        hasOccupation: b.hasOccupation?.value === 'true',
        occupations: b.occupations?.value ?? '',
      }))
    } catch (error) {
      const wait = 5_000 * attempt
      console.warn(`  batch failed (${error.message}) — retry ${attempt}/5 in ${wait / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw new Error('batch failed 5 times')
}

async function main() {
  const edges = readJson(EDGES_PATH).artists
  const previous = existsSync(OUT_PATH) ? readJson(OUT_PATH) : { nonMusicians: {}, musicMakers: {} }
  const keys = Object.entries(edges)
    .filter(([, artist]) => artist.chapters.some((chapter) => chapter.kind === 'based'))
    .map(([key]) => key)
  // Also re-check anyone withheld last time, so a corrected Wikidata item comes back.
  for (const key of Object.keys(previous.nonMusicians ?? {})) if (!keys.includes(key)) keys.push(key)
  const mbKeys = new Set(keys.filter((key) => key.includes('-')))
  const qidOf = new Map(mbWikidataIds(mbKeys))
  for (const artist of gapFillArtists()) if (artist.wikidataId && keys.includes(artist.key)) qidOf.set(artist.key, artist.wikidataId)
  const targets = keys.filter((key) => /^Q\d+$/.test(qidOf.get(key) ?? '')).map((key) => ({ key, qid: qidOf.get(key), name: edges[key]?.name ?? previous.nonMusicians?.[key]?.name }))
  console.log(`${keys.length} artists with a based chapter · ${targets.length} have a Wikidata item to check`)
  const byQid = new Map()
  const qids = [...new Set(targets.map((t) => t.qid))]
  for (let index = 0; index < qids.length; index += BATCH) {
    for (const row of await fetchBatch(qids.slice(index, index + BATCH))) byQid.set(row.qid, row)
    await new Promise((resolve) => setTimeout(resolve, PACE_MS))
  }
  const nonMusicians = {}
  const musicMakers = {}
  let unjudged = 0
  for (const target of targets) {
    const row = byQid.get(target.qid)
    if (!row || !row.hasOccupation) {
      unjudged++
      continue
    }
    if (row.musician || row.ensemble) musicMakers[target.key] = { qid: target.qid }
    else nonMusicians[target.key] = { qid: target.qid, name: target.name, occupations: row.occupations }
  }
  writeFileSync(OUT_PATH, `${JSON.stringify({ checkedAt: new Date().toISOString(), checked: targets.length, unjudged, nonMusicians, musicMakers }, null, 1)}\n`)
  console.log(`music-makers ${Object.keys(musicMakers).length} · non-musicians ${Object.keys(nonMusicians).length} · no occupation on record ${unjudged} → ${OUT_PATH}`)
  for (const [key, who] of Object.entries(nonMusicians).slice(0, 15)) console.log(`  withheld: ${who.name} (${key.slice(0, 8)}) — ${who.occupations}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
