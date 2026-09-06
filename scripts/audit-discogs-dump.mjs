/**
 * GUARD AUDIT of the local Discogs index against the 38,185 release
 * records the sweep fetched from the API (data/extra-artists-work-v2
 * .json, each with the record's own country field and structured
 * credits). The dump must agree with the API record on the same
 * release — country string, credit ids, names — before any sweep
 * reads from it. Disagreements are Discogs edits between the API
 * fetch (Aug 2026) and the Sep 1 snapshot, and are listed, not hidden.
 *
 * Also quantifies what the unsorted API sweeps missed: per configured
 * country string, dump total vs the releases the sweep saw.
 *
 * Usage: node scripts/audit-discogs-dump.mjs
 * Writes data/discogs-dump/audit.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'
import { countryCounts, releaseIndexAvailable, releasesFor } from './lib/discogsDump.mjs'

const WORK_PATH = 'data/extra-artists-work-v2.json'
const OUT_PATH = 'data/discogs-dump/audit.json'

if (!releaseIndexAvailable()) {
  console.error('release index not complete — nothing to audit')
  process.exit(1)
}
const work = JSON.parse(readFileSync(WORK_PATH, 'utf8')).countries
const counts = countryCounts()

const totals = { cached: 0, inDump: 0, missing: 0, countryEqual: 0, countryDiffers: 0, creditIdsEqual: 0, creditIdsDiffer: 0, namesEqual: 0 }
const perCountry = {}
const diffs = []
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

for (const [code, state] of Object.entries(work)) {
  const config = COUNTRIES[code]
  if (!config || !state.credits) continue
  const dump = new Map()
  const stringTotals = {}
  for (const label of config.discogs) {
    const rows = releasesFor(label)
    stringTotals[label] = { dump: rows.length, dumpTable: counts[label]?.total ?? null }
    for (const row of rows) dump.set(row.id, row)
  }
  const sweepIds = new Set(state.releases.map((release) => release.id))
  const row = { name: config.name, sweepReleases: sweepIds.size, dumpReleases: dump.size, sweepMissedInDump: 0, dumpMissingFromSweep: 0, strings: stringTotals, cached: 0, missing: 0, countryDiffers: 0, creditIdsDiffer: 0 }
  for (const id of dump.keys()) if (!sweepIds.has(id)) row.dumpMissingFromSweep++
  for (const id of sweepIds) if (!dump.has(id)) row.sweepMissedInDump++
  for (const [idText, stored] of Object.entries(state.credits)) {
    if (!stored || Array.isArray(stored)) continue // legacy LA/PY rows carry no country
    const id = Number(idText)
    totals.cached++
    row.cached++
    const record = dump.get(id)
    if (!record) {
      // Not under this country's strings in the dump: moved, merged or deleted.
      totals.missing++
      row.missing++
      continue
    }
    totals.inDump++
    if (record.country === stored.country) totals.countryEqual++
    else {
      totals.countryDiffers++
      row.countryDiffers++
      diffs.push({ code, id, field: 'country', api: stored.country, dump: record.country })
    }
    const apiIds = stored.credits.map((credit) => credit.id)
    const dumpIds = record.artists.map((credit) => credit.id)
    if (sameSet(apiIds, dumpIds)) {
      totals.creditIdsEqual++
      const apiNames = stored.credits.map((credit) => `${credit.id}:${credit.name}`).sort()
      const dumpNames = record.artists.map((credit) => `${credit.id}:${credit.name.replace(/\s*\(\d+\)\s*$/, '')}`).sort()
      if (apiNames.join('|') === dumpNames.join('|')) totals.namesEqual++
      else diffs.push({ code, id, field: 'names', api: apiNames, dump: dumpNames })
    } else {
      totals.creditIdsDiffer++
      row.creditIdsDiffer++
      diffs.push({ code, id, field: 'creditIds', api: apiIds, dump: dumpIds })
    }
  }
  perCountry[code] = row
  console.log(`${code} ${config.name.padEnd(26)} sweep ${String(row.sweepReleases).padStart(6)} · dump ${String(row.dumpReleases).padStart(6)} · sweep never saw ${String(row.dumpMissingFromSweep).padStart(6)} · cached ${row.cached} (missing ${row.missing}, country≠ ${row.countryDiffers}, credits≠ ${row.creditIdsDiffer})`)
}

const sweepTotal = Object.values(perCountry).reduce((n, r) => n + r.sweepReleases, 0)
const dumpTotal = Object.values(perCountry).reduce((n, r) => n + r.dumpReleases, 0)
const neverSeen = Object.values(perCountry).reduce((n, r) => n + r.dumpMissingFromSweep, 0)
const summary = { ...totals, sweepTotal, dumpTotal, neverSeenBySweep: neverSeen, neverSeenShare: dumpTotal ? +(neverSeen / dumpTotal).toFixed(3) : null }
writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), summary, perCountry, diffs }, null, 2))
console.log(`\n${JSON.stringify(summary, null, 1)}`)
console.log(`→ ${OUT_PATH}`)
