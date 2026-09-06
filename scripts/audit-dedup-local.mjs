/**
 * FIDELITY AUDIT — does the local-source dedup reproduce the verdicts
 * the API-source dedup already recorded? (Standing lesson 8: a change
 * to how evidence is fetched is verified against the recorded
 * evidence, not assumed.)
 *
 * Reads data/extra-artists-work-v2.json, rebuilds each sampled
 * candidate exactly as build-extra-artists.mjs did (names from the
 * structured credits, years and titles from the releases), re-judges
 * it through the CURRENT dedup-rule.mjs (local sources when present)
 * and compares verdict + mbid with the stored verdict.
 *
 * Disagreements are expected in two known shapes and reported by
 * class: (1) the local path sees MORE evidence (every release group,
 * every exact-name artist, the full area chain) so a stored
 * 'uncorroborated-kept'/'collision-kept' may become 'duplicate' or
 * 'foreign-catalog'; (2) the dump is a snapshot (Aug 29) while the API
 * verdicts were live at sweep time. Anything else is a bug.
 *
 * Usage: node scripts/audit-dedup-local.mjs [--per-country 25] [--codes CC,CC]
 * Writes data/dedup-local-audit.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  dedupDataSources,
  judgeCandidate,
  normalizeName,
  titleKeys,
} from './lib/dedup-rule.mjs'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'

const WORK_PATH = 'data/extra-artists-work-v2.json'
const OUT_PATH = 'data/dedup-local-audit.json'
const argv = process.argv.slice(2)
const perCountry = Number(argv[argv.indexOf('--per-country') + 1]) || 25
const onlyCodes = argv.includes('--codes')
  ? argv[argv.indexOf('--codes') + 1].split(',')
  : null

const sources = dedupDataSources()
console.log(`sources: ${JSON.stringify(sources)}`)
if (Object.values(sources).some((source) => source !== 'local')) {
  console.warn('⚠ not every source is local — this audit compares like with like only when all three are.')
}

const work = JSON.parse(readFileSync(WORK_PATH, 'utf8')).countries
const JUDGED = new Set(['duplicate', 'foreign-catalog', 'collision-kept', 'uncorroborated-kept', 'new'])

/** Rebuild the candidate for a dg| key from the stored releases + credits. */
function candidateFor(state, dgId) {
  const names = new Set()
  const aliases = new Set()
  const years = new Set()
  const titles = new Set()
  let canonical = null
  for (const release of state.releases) {
    const stored = state.credits[release.id]
    const credits = Array.isArray(stored) ? stored : stored?.credits
    if (!credits) continue
    for (const credit of credits) {
      if (credit.id !== dgId) continue
      canonical ??= credit.name
      names.add(credit.name)
      if (credit.anv && normalizeName(credit.anv) !== normalizeName(credit.name)) aliases.add(credit.anv)
      if (release.year) years.add(release.year)
      for (const key of titleKeys(release.title)) titles.add(key)
    }
  }
  if (!canonical) return null
  return { names: [canonical, ...aliases], years: [...years], titles }
}

const results = []
const tally = { agree: 0, disagree: 0, unreconstructible: 0 }
const matrix = {}
for (const [code, state] of Object.entries(work)) {
  if (onlyCodes && !onlyCodes.includes(code)) continue
  const config = COUNTRIES[code]
  if (!config || !state.verdicts) continue
  const keys = Object.entries(state.verdicts)
    .filter(([key, verdict]) => key.startsWith('dg|') && JUDGED.has(verdict.verdict))
    .map(([key]) => key)
  // Deterministic spread: every Nth key.
  const step = Math.max(1, Math.floor(keys.length / perCountry))
  const sample = keys.filter((_, index) => index % step === 0).slice(0, perCountry)
  for (const key of sample) {
    const stored = state.verdicts[key]
    const cand = candidateFor(state, Number(key.slice(3)))
    if (!cand) {
      tally.unreconstructible++
      continue
    }
    const judged =
      (await judgeCandidate(cand, { country: code, areaName: config.mbArea })) ??
      { verdict: 'new', basis: 'no-exact-hit' }
    const sameVerdict = judged.verdict === stored.verdict
    const sameMbid = (judged.mbid ?? null) === (stored.mbid ?? null)
    const cell = `${stored.verdict} → ${judged.verdict}`
    matrix[cell] = (matrix[cell] ?? 0) + 1
    if (sameVerdict && sameMbid) tally.agree++
    else {
      tally.disagree++
      results.push({
        code,
        key,
        name: cand.names[0],
        stored: { verdict: stored.verdict, basis: stored.basis, mbid: stored.mbid ?? null, mbName: stored.mbName ?? null },
        local: { verdict: judged.verdict, basis: judged.basis, mbid: judged.mbid ?? null, mbName: judged.mbName ?? null },
      })
    }
  }
  console.log(`${code}: ${sample.length} sampled · running agree ${tally.agree} / disagree ${tally.disagree}`)
}

writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), sources, tally, matrix, disagreements: results }, null, 2))
console.log(`\n${JSON.stringify(tally)}`)
console.log(Object.entries(matrix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v.toString().padStart(5)}  ${k}`).join('\n'))
console.log(`→ ${OUT_PATH}`)
