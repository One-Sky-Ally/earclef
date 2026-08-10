/**
 * Retroactive dedup-rule-v3 pass (owner-approved) over the 338
 * candidates the v2 rebuild dropped on name verdicts.
 *
 *   node scripts/apply-dedup-rule-v3.mjs
 *
 * Uses the audit's captured MBIDs as record hints — each contested
 * identity is re-judged against the MB RECORD (fetched by id, index-
 * proof), not against a fresh search. Search runs only for drops the
 * audit couldn't reproduce. Survivors are reinstated into
 * lib/explore/extra-artists.json; every verdict + evidence lands in
 * data/dedup-reinstatement-report.json (committed) for review.
 * Resumable via data/dedup-v3-work.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dedupProbes,
  exactNameHit,
  fetchMbArtistRecord,
  judgeNameHit,
  normalizeName,
  searchMbArtists,
  titleKeys,
} from './lib/dedup-rule.mjs'

const ROOT = process.cwd()
const WORK_PATH = join(ROOT, 'data', 'dedup-v3-work.json')
const REPORT_PATH = join(ROOT, 'data', 'dedup-reinstatement-report.json')
const DATASET_PATH = join(ROOT, 'lib', 'explore', 'extra-artists.json')
const COUNTRY_NAMES = { LA: 'Laos', PY: 'Paraguay' }

const pipeline = JSON.parse(
  readFileSync(join(ROOT, 'data', 'extra-artists-work-v2.json'), 'utf8'),
)
const audit = JSON.parse(
  readFileSync(join(ROOT, 'data', 'dedup-drop-audit.json'), 'utf8'),
)
const work = existsSync(WORK_PATH)
  ? JSON.parse(readFileSync(WORK_PATH, 'utf8'))
  : { decisions: {} }

/** Rebuild candidate facts (names, years, titles, styles) per key. */
function candidateFacts(code, key) {
  const state = pipeline.countries[code]
  const facts = {
    names: [],
    years: new Set(),
    titles: new Set(),
    styles: new Set(),
    releaseCount: 0,
    dgId: null,
    wikidataId: null,
  }
  if (key.startsWith('dg|')) {
    facts.dgId = Number(key.slice(3))
    for (const [releaseId, credits] of Object.entries(state.credits ?? {})) {
      for (const credit of credits ?? []) {
        if (credit.id !== facts.dgId) continue
        if (!facts.names.includes(credit.name)) facts.names.push(credit.name)
        if (credit.anv && !facts.names.includes(credit.anv)) {
          facts.names.push(credit.anv)
        }
        const release = (state.releases ?? []).find(
          (candidate) => String(candidate.id) === String(releaseId),
        )
        if (release) {
          facts.releaseCount++
          if (release.year) facts.years.add(release.year)
          for (const style of release.style ?? []) facts.styles.add(style)
          for (const titleKey of titleKeys(release.title)) {
            facts.titles.add(titleKey)
          }
        }
      }
    }
  } else if (key.startsWith('wd|')) {
    facts.wikidataId = key.slice(3)
    const person = (state.wikidata ?? []).find(
      (entry) => entry.wikidataId === facts.wikidataId,
    )
    if (person) {
      facts.names.push(person.name)
      if (person.year) facts.years.add(person.year)
      facts.dgId = person.discogsId ?? null
    }
  } else if (key.startsWith('nm|')) {
    facts.names.push(key.slice(3))
    // Fallback candidates: recover titles from matching display strings.
    for (const release of state.releases ?? []) {
      const parsed = release.title.split(/\s+[–—-]\s+/)[0] ?? ''
      if (normalizeName(parsed) === normalizeName(key.slice(3))) {
        facts.releaseCount++
        if (release.year) facts.years.add(release.year)
        for (const style of release.style ?? []) facts.styles.add(style)
        for (const titleKey of titleKeys(release.title)) {
          facts.titles.add(titleKey)
        }
      }
    }
  }
  return facts
}

for (const [auditKey, drop] of Object.entries(audit.drops)) {
  if (work.decisions[auditKey]) continue
  const [code, key] = [drop.code, auditKey.slice(drop.code.length + 1)]
  const facts = candidateFacts(code, key)
  if (facts.names.length === 0) facts.names = drop.names
  const candidate = {
    names: facts.names,
    years: [...facts.years],
    titles: facts.titles,
  }
  const countryName = COUNTRY_NAMES[code]
  let decision

  if (drop.verdict === 'fuzzy') {
    // Point 1: fuzzy never drops. Record the near miss and move on.
    decision = {
      verdict: 'fuzzy-kept',
      basis: 'fuzzy-may-never-drop',
      nearMiss: drop.result.mbid ?? null,
      mbName: drop.result.mbName ?? null,
    }
  } else {
    let judged = null
    const hintMbid = drop.result.mbid ?? null
    if (hintMbid) {
      const artist = await fetchMbArtistRecord(hintMbid)
      if (artist) {
        const probeHit = dedupProbes(candidate.names)
          .map((probe) => exactNameHit(artist, probe))
          .find(Boolean)
        judged = probeHit
          ? await judgeNameHit(candidate, artist, probeHit, countryName)
          : // Audit matched via a path the rule no longer allows
            // (untyped alias / bare-forename ANV): only record-level
            // identity (shared title) may still drop it.
            await judgeNameHit(candidate, artist, 'disallowed-name-path', countryName).then(
              (result) =>
                result.basis.startsWith('shared-title')
                  ? result
                  : { ...result, verdict: 'uncorroborated-kept', basis: `name-path-disallowed(${result.basis})` },
            )
      }
    }
    if (!judged) {
      // Irreproducible in the audit — one fresh search, judged by rule.
      for (const probe of dedupProbes(candidate.names)) {
        const artists = await searchMbArtists(probe)
        const hit = artists
          .map((artist) => ({ artist, basis: exactNameHit(artist, probe) }))
          .find((entry) => entry.basis)
        if (hit) {
          judged = await judgeNameHit(candidate, hit.artist, hit.basis, countryName)
          break
        }
      }
    }
    decision = judged ?? { verdict: 'new', basis: 'no-exact-hit-today' }
  }

  work.decisions[auditKey] = {
    code,
    key,
    names: candidate.names,
    years: candidate.years,
    releaseCount: facts.releaseCount,
    styles: [...facts.styles].slice(0, 3),
    dgId: facts.dgId,
    wikidataId: facts.wikidataId,
    ...decision,
  }
  writeFileSync(WORK_PATH, JSON.stringify(work, null, 1))
  console.log(`${auditKey}: ${decision.verdict} (${decision.basis})`)
}

// ---- reinstate survivors into the dataset --------------------------
const KEEP = new Set(['fuzzy-kept', 'collision-kept', 'uncorroborated-kept', 'new'])
const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
const reinstated = []
for (const decision of Object.values(work.decisions)) {
  if (!KEEP.has(decision.verdict)) continue
  const list = dataset.countries[decision.code] ?? []
  // Loose id equality (Wikidata-sourced ids are strings) and fully
  // collapsed names (apostrophes must not distinguish "Los Joker's").
  const collapse = (value) => normalizeName(value).replace(/\s+/g, '')
  const exists = list.some(
    (artist) =>
      (decision.dgId != null &&
        artist.discogsArtistId != null &&
        String(artist.discogsArtistId) === String(decision.dgId)) ||
      collapse(artist.name) === collapse(decision.names[0]),
  )
  if (exists) continue
  const years = [...decision.years].sort((a, b) => a - b)
  const aliases = decision.names.slice(1).filter(
    (alias) => normalizeName(alias) !== normalizeName(decision.names[0]),
  )
  dataset.countries[decision.code] = [
    ...list,
    {
      name: decision.names[0],
      source: decision.wikidataId && decision.dgId == null ? 'wikidata' : 'discogs',
      firstYear: years[0] ?? null,
      lastYear: years[years.length - 1] ?? null,
      styles: decision.styles ?? [],
      releaseCount: decision.releaseCount ?? 0,
      discogsArtistId: decision.dgId ?? null,
      wikidataId: decision.wikidataId ?? null,
      ...(aliases.length > 0 ? { aliases: aliases.slice(0, 6) } : {}),
      reinstatedBy: 'dedup-rule-v3',
    },
  ]
  reinstated.push(`${decision.code}: ${decision.names[0]} [${decision.verdict}: ${decision.basis}]`)
}
writeFileSync(DATASET_PATH, `${JSON.stringify(dataset, null, 2)}\n`)

const values = Object.values(work.decisions)
const summary = {}
for (const decision of values) {
  summary[decision.verdict] = (summary[decision.verdict] ?? 0) + 1
}
writeFileSync(
  REPORT_PATH,
  `${JSON.stringify({ generatedAt: '2026-08-09', summary, reinstated, decisions: work.decisions }, null, 1)}\n`,
)
console.log('\n=== RETRO PASS SUMMARY ===')
console.log(JSON.stringify(summary, null, 1))
console.log(`reinstated: ${reinstated.length}`)
for (const line of reinstated) console.log(`  ${line}`)
