#!/usr/bin/env node
/**
 * Artist Chapters phase 3 — the MusicBrainz layer's own place facts for
 * every artist the globe files, read ONCE from the local artist dump
 * (data/mb-dump/artist.tar.xz, streamed with the system tar, ~7 min):
 *
 *   type, the area / begin-area / end-area resolved to ISO codes through
 *   the area index, the life-span, and every artist→place relationship
 *   with its type, dates, and the place's city and country.
 *
 * Facts only — which of them become chapters is decided by
 * scripts/build-presence-edges.mjs under the owner's rules (a place is a
 * chapter only where the artist made music; study, birth and death
 * places never). Output: data/mb-artist-places.json, keyed by MBID.
 *
 *   node scripts/build-mb-artist-places.mjs
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
import { areaChain } from './lib/mbAreaIndex.mjs'
import { mbHomes } from './lib/presenceSources.mjs'

const ARCHIVE = 'data/mb-dump/artist.tar.xz'
const MEMBER = 'mbdump/artist'
const OUT_PATH = 'data/mb-artist-places.json'

/** [iso, cityName] for an area: the first ISO-3166-1 code up the chain, and the first City/Municipality on the way. */
function resolveArea(area) {
  if (!area?.id) return { iso: null, city: null }
  let city = null
  for (const node of areaChain(area.id)) {
    if (!city && (node.type === 'City' || node.type === 'Municipality')) city = node.name
    const iso = (node.isoCodes ?? []).find((code) => /^[A-Z]{2}$/.test(code))
    if (iso) return { iso, city }
  }
  return { iso: null, city }
}

const year = (value) => {
  const parsed = Number(String(value ?? '').slice(0, 4))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

async function main() {
  const wanted = mbHomes()
  console.log(`${wanted.size.toLocaleString()} MusicBrainz artists the globe files`)
  const facts = {}
  let scanned = 0
  let found = 0
  const child = spawn('tar', ['-xJOf', ARCHIVE, MEMBER])
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.warn(`  tar: ${text}`)
  })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line) continue
    scanned++
    // Cheap pre-check before parsing 3M rows: any id in the row that is
    // one of ours (the artist's own id is not always the first "id" —
    // an area or alias can precede it).
    let hit = false
    for (const match of line.matchAll(/"id":"([0-9a-f-]{36})"/g)) {
      if (wanted.has(match[1])) {
        hit = true
        break
      }
    }
    if (!hit) continue
    let artist
    try {
      artist = JSON.parse(line)
    } catch {
      continue
    }
    if (!wanted.has(artist.id)) continue
    found++
    const area = resolveArea(artist.area)
    const beginArea = resolveArea(artist['begin-area'])
    const endArea = resolveArea(artist['end-area'])
    const places = (artist.relations ?? [])
      .filter((relation) => relation['target-type'] === 'place' && relation.place)
      .map((relation) => {
        const placeArea = resolveArea(relation.place.area)
        return {
          type: relation.type,
          place: relation.place.name,
          placeId: relation.place.id,
          placeType: relation.place.type ?? null,
          city: placeArea.city,
          iso: placeArea.iso,
          begin: year(relation.begin),
          end: year(relation.end),
          ended: Boolean(relation.ended),
        }
      })
    facts[artist.id] = {
      name: artist.name,
      type: artist.type ?? null,
      country: artist.country ?? null,
      area: artist.area ? { name: artist.area.name, ...area } : null,
      beginArea: artist['begin-area'] ? { name: artist['begin-area'].name, ...beginArea } : null,
      endArea: artist['end-area'] ? { name: artist['end-area'].name, ...endArea } : null,
      lifeBegin: year(artist['life-span']?.begin),
      lifeEnd: year(artist['life-span']?.end),
      ...(places.length > 0 ? { places } : {}),
    }
    if (found % 20000 === 0) console.log(`  ${scanned.toLocaleString()} scanned · ${found.toLocaleString()} of ours found`)
  }
  const exitCode = await new Promise((resolve) => child.on('close', resolve))
  if (exitCode !== 0) throw new Error(`tar exited ${exitCode} — facts INCOMPLETE, not written`)
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), scanned, found, artists: facts }))
  console.log(`${scanned.toLocaleString()} scanned · ${found.toLocaleString()} of ${wanted.size.toLocaleString()} found → ${OUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
