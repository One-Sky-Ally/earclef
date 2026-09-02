/**
 * How many of the re-dating candidates can be reached by ID-LEVEL
 * identity, and how many will fall to the name-unique fallback?
 *
 * This is the number that decides how much of Stage 2's evidence rests
 * on MusicBrainz's own curated Discogs relation (strongest) versus on a
 * name being unique on Discogs (weaker, and the owner's to rule on).
 * It exists because the founding case — Donato Racciatti — has NO
 * Discogs relation, which showed that id-only coverage is thinnest on
 * exactly the vintage non-Anglo catalogue this work targets.
 *
 * Read-only, no network. Run after build-mb-artist-index.mjs.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  artistLinksAvailable,
  artistLinksSnapshot,
  discogsIdsFor,
} from './lib/mbArtistLinks.mjs'

const SWEEP_DIR = 'data/rg-dating-sweep'

if (!artistLinksAvailable()) {
  console.error('No artist-links index — run scripts/build-mb-artist-index.mjs first.')
  process.exit(1)
}

const meta = artistLinksSnapshot()
console.log(`artist-links snapshot: ${meta?.snapshot ?? 'unknown'}`)
console.log(
  `index holds ${meta?.withDiscogs?.toLocaleString() ?? '?'} artists with a Discogs relation\n`,
)

let artists = 0
let candidates = 0
let linked = 0
let linkedCandidates = 0
let ambiguous = 0
let unlinked = 0
let unlinkedCandidates = 0
const perCountry = []

for (const file of readdirSync(SWEEP_DIR).filter((f) => f.endsWith('.json'))) {
  const code = file.replace(/\.json$/, '')
  const shard = JSON.parse(readFileSync(join(SWEEP_DIR, file), 'utf8'))
  let cLinked = 0
  let cTotal = 0
  for (const row of shard.artists) {
    if (row.candidates.length === 0) continue
    artists += 1
    cTotal += 1
    candidates += row.candidates.length
    const ids = discogsIdsFor(row.id)
    if (ids.length === 1) {
      linked += 1
      cLinked += 1
      linkedCandidates += row.candidates.length
    } else if (ids.length > 1) {
      // Ambiguity is not identity — these fall to the name path too.
      ambiguous += 1
      unlinkedCandidates += row.candidates.length
    } else {
      unlinked += 1
      unlinkedCandidates += row.candidates.length
    }
  }
  if (cTotal > 0) perCountry.push({ code, total: cTotal, linked: cLinked })
}

const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0')

console.log(`candidate-carrying artists : ${artists.toLocaleString()}`)
console.log(`candidate release groups   : ${candidates.toLocaleString()}`)
console.log(
  `\nID-CROSSWALK (MB's own discogs relation, strongest tier):`,
)
console.log(
  `  artists    ${linked.toLocaleString()} (${pct(linked, artists)}%)   candidates ${linkedCandidates.toLocaleString()} (${pct(linkedCandidates, candidates)}%)`,
)
console.log(`  ambiguous (2+ relations, rejected): ${ambiguous.toLocaleString()}`)
console.log(
  `\nFALL TO NAME-UNIQUE FALLBACK (owner's ruling applies):`,
)
console.log(
  `  artists    ${(unlinked + ambiguous).toLocaleString()} (${pct(unlinked + ambiguous, artists)}%)   candidates ${unlinkedCandidates.toLocaleString()} (${pct(unlinkedCandidates, candidates)}%)`,
)

// Where id-coverage is weakest is where the fallback matters most — and
// that is expected to be the vintage, non-Anglo catalogue.
const ranked = perCountry
  .filter((row) => row.total >= 20)
  .map((row) => ({ ...row, rate: row.linked / row.total }))
  .sort((a, b) => a.rate - b.rate)
console.log(`\nweakest id-coverage (countries with 20+ candidate artists):`)
for (const row of ranked.slice(0, 12)) {
  console.log(
    `  ${row.code}  ${String(row.linked).padStart(4)}/${String(row.total).padStart(4)}  ${pct(row.linked, row.total)}%`,
  )
}
console.log(`\nstrongest id-coverage:`)
for (const row of ranked.slice(-6).reverse()) {
  console.log(
    `  ${row.code}  ${String(row.linked).padStart(4)}/${String(row.total).padStart(4)}  ${pct(row.linked, row.total)}%`,
  )
}
