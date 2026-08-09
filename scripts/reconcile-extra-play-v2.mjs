/**
 * Post-rebuild reconciliation for the structured-credits v2 dataset:
 *
 *   node scripts/reconcile-extra-play-v2.mjs <before-dataset.json> <before-play.json>
 *
 * 1. MIGRATES committed VERIFIED play links whose extraPlayKey changed
 *    (an nm:/wd: entry that now carries a real Discogs id) into
 *    data/extra-play-work.json under the new key — a working play
 *    link must never be lost to a key rename. Null verdicts are NOT
 *    migrated: the rebuilt entries carry more aliases (ANVs), so a
 *    fresh sweep can only find more.
 * 2. VERIFIES owner-attested aliases survived (dg:4897853, dg:9950524).
 * 3. Prints the owner-requested before/after report data.
 * Writes ONLY data/extra-play-work.json (the play sweep's resumable
 * state); the committed extra-play.json is rebuilt by the sweep.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const [beforeDatasetPath, beforePlayPath] = process.argv.slice(2)
if (!beforeDatasetPath || !beforePlayPath) {
  throw new Error('usage: node scripts/reconcile-extra-play-v2.mjs <before-dataset> <before-play>')
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** MUST mirror extraPlayKey in lib/explore/extraArtists.ts exactly. */
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
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

const before = JSON.parse(readFileSync(beforeDatasetPath, 'utf8'))
const beforePlay = JSON.parse(readFileSync(beforePlayPath, 'utf8'))
const after = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'explore', 'extra-artists.json'), 'utf8'),
)
const workPath = join(ROOT, 'data', 'extra-play-work.json')
const work = JSON.parse(readFileSync(workPath, 'utf8'))

const beforeArtists = Object.entries(before.countries).flatMap(([c, list]) =>
  list.map((a) => ({ ...a, country: c, key: extraPlayKey(a) })),
)
const afterArtists = Object.entries(after.countries).flatMap(([c, list]) =>
  list.map((a) => ({ ...a, country: c, key: extraPlayKey(a) })),
)
const afterKeys = new Set(afterArtists.map((a) => a.key))

// --- 1. migrate verified plays across key renames -------------------
const migrations = []
const lost = []
for (const old of beforeArtists) {
  const verdict = beforePlay.entries[old.key]
  if (!verdict?.play) continue
  if (afterKeys.has(old.key)) continue // key unchanged — nothing to do
  // Same artist, new key: match by exact normalized name or alias.
  const oldNames = [old.name, ...(old.aliases ?? [])].map(normalizeName)
  const match = afterArtists.find((candidate) => {
    const names = [candidate.name, ...(candidate.aliases ?? [])].map(
      normalizeName,
    )
    return names.some((n) => n && oldNames.includes(n))
  })
  if (!match) {
    lost.push(`${old.country} ${old.name} (${old.key}) — no new-entry match`)
    continue
  }
  if (!work.entries[match.key]?.play) {
    work.entries[match.key] = {
      name: match.name,
      country: match.country,
      play: verdict.play,
      via: work.entries[old.key]?.via ?? 'migrated',
      migratedFrom: old.key,
      checkedAt: new Date().toISOString(),
    }
    migrations.push(`${old.key} -> ${match.key} (${match.name}: ${verdict.play.url})`)
  }
}
writeFileSync(workPath, JSON.stringify(work, null, 1))

// --- 2. owner-attested alias verification ---------------------------
const MUST_HAVE = {
  4897853: ['ກ. ວິເສດ', 'ກ. ວິເສສ', 'K. Viseth', 'KOR VISETH'],
  9950524: ['ນ.ສ. ສົມຟອງ', 'ນ.ສ.ສົມຟອງ', 'Miss Somfong'],
}
const aliasFailures = []
for (const [id, required] of Object.entries(MUST_HAVE)) {
  const entry = afterArtists.find((a) => String(a.discogsArtistId) === id)
  if (!entry) {
    aliasFailures.push(`dg:${id} MISSING from rebuilt dataset`)
    continue
  }
  for (const alias of required) {
    if (!(entry.aliases ?? []).includes(alias)) {
      aliasFailures.push(`dg:${id} (${entry.name}) lost attested alias "${alias}"`)
    }
  }
}

// --- 3. report ------------------------------------------------------
const slashAfter = afterArtists.filter((a) => a.name.includes('/'))
console.log('=== RECONCILIATION REPORT ===')
console.log(`artists before: ${beforeArtists.length} | after: ${afterArtists.length}`)
console.log(`unsplit "/" strings after rebuild: ${slashAfter.length}`)
for (const a of slashAfter) console.log(`  ${a.country}: ${a.name}`)
for (const [id, label] of [
  [9950401, 'ບຸນທົງ ວົງສາລີ'],
  [5802688, 'ສຸມຸນທາ ສີຣິມະໂນທັມ'],
]) {
  const hit = afterArtists.find((a) => a.discogsArtistId === id)
  console.log(
    `expected identity dg:${id} (${label}): ${hit ? `LANDED as "${hit.name}" [${hit.country}]` : 'NOT in dataset'}`,
  )
}
console.log(`owner-alias check: ${aliasFailures.length === 0 ? 'ALL PRESERVED' : 'FAILURES:'}`)
for (const failure of aliasFailures) console.log(`  ${failure}`)
console.log(`play migrations: ${migrations.length}`)
for (const line of migrations) console.log(`  ${line}`)
console.log(`verified plays LOST to key renames: ${lost.length}`)
for (const line of lost) console.log(`  ${line}`)
process.exit(aliasFailures.length > 0 || lost.length > 0 ? 1 : 0)
