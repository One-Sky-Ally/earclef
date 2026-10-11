#!/usr/bin/env node
/**
 * Artist Chapters phase 3 — "formed in" is origin for GROUPS (owner rule:
 * an inconsistency fixed, not a new rule). A group whose MusicBrainz
 * begin-area resolves to a different country from the area it is filed
 * under is shown under its formation country, and the filed country
 * becomes an undated based chapter (the corrections pass of
 * build-presence-edges.mjs does that for every move automatically).
 *
 * Writes the moves into lib/explore/origin-corrections.json beside the
 * arbitrated person moves, with `type: 'Group'` (no career offset) and
 * `why: 'formation'`. Persons are never touched here: a person's
 * begin-area is their birthplace, and birth alone is never an edge.
 *
 * Input: data/mb-artist-places.json (scripts/build-mb-artist-places.mjs).
 *
 *   node scripts/build-formation-moves.mjs --dry-run
 *   node scripts/build-formation-moves.mjs
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countryNames, readJson, CORRECTIONS_PATH, COUNTRY_DIR } from './lib/presenceSources.mjs'

const FACTS_PATH = 'data/mb-artist-places.json'
const DRY_RUN = process.argv.includes('--dry-run')

function main() {
  const names = countryNames()
  const facts = readJson(FACTS_PATH).artists ?? {}
  const corrections = readJson(CORRECTIONS_PATH)
  const existing = corrections.moves ?? {}
  // Where each MB artist is filed today, with the pool record (weight, tags, years).
  const filed = new Map()
  for (const file of readdirSync(COUNTRY_DIR)) {
    if (!file.endsWith('.json')) continue
    const code = file.replace('.json', '')
    for (const artist of readJson(join(COUNTRY_DIR, file)).artists ?? []) filed.set(artist.id, { code, artist })
  }
  const moves = {}
  const stats = { groups: 0, formedElsewhere: 0, alreadyMoved: 0, formationNotOnGlobe: 0, sameCountry: 0, written: 0 }
  const byPair = new Map()
  for (const [mbid, fact] of Object.entries(facts)) {
    if (fact.type !== 'Group') continue
    const pooled = filed.get(mbid)
    if (!pooled) continue
    stats.groups++
    const formation = fact.beginArea?.iso
    if (!formation || formation === pooled.code) {
      stats.sameCountry++
      continue
    }
    stats.formedElsewhere++
    if (existing[mbid]) {
      stats.alreadyMoved++
      continue
    }
    if (!names.has(formation)) {
      stats.formationNotOnGlobe++
      continue
    }
    moves[mbid] = {
      from: pooled.code,
      to: formation,
      name: fact.name,
      begin: fact.lifeBegin ? String(fact.lifeBegin) : null,
      end: fact.lifeEnd ? String(fact.lifeEnd) : null,
      weight: pooled.artist.w ?? 0,
      tags: pooled.artist.t ?? [],
      beginArea: fact.beginArea.name,
      type: 'Group',
      why: `formed in ${fact.beginArea.name} (MusicBrainz begin-area → ${formation}); filed under ${pooled.code} by area`,
    }
    stats.written++
    const pair = `${pooled.code}→${formation}`
    byPair.set(pair, (byPair.get(pair) ?? 0) + 1)
  }
  console.log(stats)
  console.log('top pairs:', [...byPair].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([pair, count]) => `${pair} ${count}`).join(' · '))
  const sample = Object.values(moves).slice(0, 8).map((move) => `${move.name}: ${move.from} → ${move.to} (${move.beginArea})`)
  console.log(sample.join('\n'))
  if (DRY_RUN) {
    console.log('dry run — nothing written')
    return
  }
  const merged = { ...corrections, formationAt: new Date().toISOString(), moves: { ...existing, ...moves } }
  writeFileSync(CORRECTIONS_PATH, `${JSON.stringify(merged, null, 2)}\n`)
  console.log(`→ ${CORRECTIONS_PATH}: ${Object.keys(existing).length} + ${stats.written} moves`)
}

main()
