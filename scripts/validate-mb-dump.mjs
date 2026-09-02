/**
 * DOES THE LOCAL DUMP AGREE WITH THE LIVE API? (owner-gated, Aug 31,
 * 2026: "Hold Stage 1 until it's validated against the Uruguay shard.")
 *
 * The Uruguay shard was swept from the live MusicBrainz API — 182
 * artists, every release group, complete rows. This re-derives the same
 * 182 artists from the local dump index and compares them record by
 * record. Nothing downstream may trust the dump until this passes.
 *
 * WHAT COUNTS AS AGREEMENT, and why each is checked separately:
 *   - the release-group ID SET per artist (did we find the same works?)
 *   - `first-release-date` per ID (the field the whole bug is about)
 *   - `secondary-types` per ID (the Compilation signal)
 *   - `primary-type` per ID
 * A mismatch in any of these is reported with the artist and the IDs,
 * not summarised away — the point of a validation gate is to show its
 * working.
 *
 * EXPECTED, NOT-A-FAILURE DIFFERENCES, stated up front so they are not
 * mistaken for bugs: the API sweep caps at MAX_PAGES × 100 = 300 groups
 * and marks such rows `complete: false`, while the dump has no cap — so
 * the dump may legitimately hold MORE for a prolific artist. Those are
 * reported as `dump-extra-capped` and excluded from the failure count.
 * A genuine drift (the dump snapshot predates an API edit) shows up as
 * a date or type mismatch and IS counted, because that is exactly the
 * staleness the owner needs quantified before trusting the index.
 *
 * Usage: node scripts/validate-mb-dump.mjs [--country UY]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dumpIndexAvailable,
  dumpSnapshot,
  releaseGroupsFor,
} from './lib/mbDumpIndex.mjs'

const SWEEP_DIR = 'data/rg-dating-sweep'
const countryArg = process.argv.indexOf('--country')
const COUNTRY = countryArg !== -1 ? process.argv[countryArg + 1] : 'UY'
/** API sweep's cap; a dump row count above this is expected, not wrong. */
const API_PAGE_CAP = 300

if (!dumpIndexAvailable()) {
  console.error('No local dump index — run scripts/build-mb-dump-index.mjs.')
  process.exit(1)
}
const shardPath = join(SWEEP_DIR, `${COUNTRY}.json`)
if (!existsSync(shardPath)) {
  console.error(`No API-derived shard at ${shardPath} to validate against.`)
  process.exit(1)
}

const meta = dumpSnapshot()
const shard = JSON.parse(readFileSync(shardPath, 'utf8'))
console.log(`validating ${COUNTRY}: ${shard.artists.length} artists`)
console.log(`dump snapshot: ${meta?.snapshot ?? 'unknown'}\n`)

const norm = (value) => (value ?? '').toString()
const sortedTypes = (list) => [...(list ?? [])].sort().join('|')

let artistsChecked = 0
let artistsExact = 0
let apiOnlyIds = 0
let dumpOnlyIds = 0
let dateMismatch = 0
let typeMismatch = 0
let cappedArtists = 0
const failures = []

for (const row of shard.artists) {
  artistsChecked += 1

  // The API shard stores candidates in full but only YEARS for the
  // rest, so the comparable universe is the candidate records plus the
  // counts. Candidates carry id/date/type — enough for a real diff.
  const apiById = new Map(
    row.candidates.map((c) => [
      c.id,
      { date: norm(c.year), primary: norm(c.type), secondary: sortedTypes(c.secondary) },
    ]),
  )
  const dumpGroups = releaseGroupsFor(row.id)
  const dumpById = new Map(
    dumpGroups.map((g) => [
      g.id,
      {
        date: norm((g['first-release-date'] ?? '').slice(0, 4)),
        primary: norm(g['primary-type']),
        secondary: sortedTypes(g['secondary-types']),
      },
    ]),
  )

  // Capped API rows legitimately hold less than the dump.
  const capped = row.totalGroups > API_PAGE_CAP || row.complete === false
  if (capped) cappedArtists += 1

  const issues = []
  for (const [id, api] of apiById) {
    const dump = dumpById.get(id)
    if (!dump) {
      apiOnlyIds += 1
      issues.push(`API-only ${id}`)
      continue
    }
    if (api.date !== dump.date) {
      dateMismatch += 1
      issues.push(`date ${id}: api=${api.date} dump=${dump.date}`)
    }
    if (api.primary !== dump.primary || api.secondary !== dump.secondary) {
      typeMismatch += 1
      issues.push(
        `type ${id}: api=${api.primary}/${api.secondary} dump=${dump.primary}/${dump.secondary}`,
      )
    }
  }

  // Total-count agreement is the other half: the dump should hold the
  // same number of groups the API reported, cap allowing.
  const countGap = dumpGroups.length - row.totalGroups
  if (!capped && countGap !== 0) {
    dumpOnlyIds += Math.max(0, countGap)
    issues.push(
      `count: api=${row.totalGroups} dump=${dumpGroups.length} (${countGap > 0 ? '+' : ''}${countGap})`,
    )
  }

  if (issues.length === 0) artistsExact += 1
  else failures.push({ name: row.name, id: row.id, capped, issues })
}

console.log(`artists compared     : ${artistsChecked}`)
console.log(`exact agreement      : ${artistsExact}`)
console.log(`artists with issues  : ${failures.length}`)
console.log(`  API-only group ids : ${apiOnlyIds}`)
console.log(`  count gaps (uncapped): ${dumpOnlyIds}`)
console.log(`  first-release-date mismatches: ${dateMismatch}`)
console.log(`  type mismatches    : ${typeMismatch}`)
console.log(`  capped API rows (dump may hold more, expected): ${cappedArtists}`)

if (failures.length > 0) {
  console.log('\n— every disagreement, in full —')
  for (const failure of failures.slice(0, 40)) {
    console.log(`\n  ${failure.name} (${failure.id})${failure.capped ? ' [API row was capped]' : ''}`)
    for (const issue of failure.issues.slice(0, 8)) console.log(`     ${issue}`)
    if (failure.issues.length > 8) {
      console.log(`     …and ${failure.issues.length - 8} more`)
    }
  }
  if (failures.length > 40) console.log(`\n  …and ${failures.length - 40} more artists`)
}

const clean = dateMismatch === 0 && typeMismatch === 0 && apiOnlyIds === 0
console.log(
  `\n${clean ? 'PASS' : 'FAIL'} — the dump ${clean ? 'agrees with' : 'DISAGREES with'} the live API on ${COUNTRY}.`,
)
process.exit(clean ? 0 : 1)
