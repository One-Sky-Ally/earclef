/**
 * Pattern-ruling review pass (owner ruling, Aug 11, 2026) over the
 * collision-kept parent-state/metropole/circuit cases compiled during
 * the sparse-country rollout (Batches smoke/A/B1–B3).
 *
 * THE RULING, encoded:
 *   (a) metropole-residence — origin evidence points INTO the pool
 *       country (birth/formation/citizenship) → KEEP with the Naghma
 *       note treatment (MB area recorded as residence-not-origin).
 *   (b) regional pressing circuit / famous-name tier — MB match has a
 *       DIFFERENT country area AND corroboration ties the candidate to
 *       that foreign artist (Wikidata origin, or distinctive name +
 *       era overlap) → EXCLUDE by origin (Zarsanga treatment).
 *   (c) generic-name collisions → KEEP per policy, unchanged (era
 *       coincidence is not identity for a generic name).
 *   No corroboration either way → KEEP per policy, HELD for the owner.
 *   The discriminator is ORIGIN, not area and not fame.
 *
 * Hard-pinned HELD (owner-flagged history classes, never auto-ruled):
 * TL×Indonesia (occupation era), KP×South Korea (partition), NP
 * Tibetan-exile.
 *
 * Usage:
 *   node scripts/apply-pattern-ruling.mjs --gather   (evidence + proposals
 *     → data/pattern-ruling-report.json; resumable, ~8 min for ~125 cases)
 *   node scripts/apply-pattern-ruling.mjs --apply    (apply the report's
 *     proposals — run only after the table has been reviewed)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'

const WORK_PATH = 'data/extra-artists-work-v2.json'
const RULE_WORK_PATH = 'data/pattern-ruling-work.json'
const REPORT_PATH = 'data/pattern-ruling-report.json'
const DATASET_PATH = 'lib/explore/extra-artists.json'
const UA = 'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** MB areas that count as this pool's parent-state/metropole/circuit. */
const PARENT = {
  TD: ['France'], GQ: ['Spain', 'France'], SB: ['United Kingdom', 'Australia'],
  DJ: ['France'], VU: ['France', 'United Kingdom'], SZ: ['South Africa', 'United Kingdom'],
  MR: ['France'], RW: ['Belgium', 'France'], TJ: ['Russia'], GW: ['Portugal'],
  LS: ['South Africa', 'United Kingdom'], OM: ['United Kingdom', 'India'],
  MW: ['United Kingdom', 'South Africa'], NE: ['France', 'Nigeria'],
  GM: ['United Kingdom', 'Senegal'], BT: ['India'], SO: ['Italy', 'United Kingdom'],
  LR: ['United States'], BW: ['South Africa', 'United Kingdom'], CF: ['France'],
  QA: ['United Kingdom', 'Egypt'], BN: ['Malaysia', 'United Kingdom'],
  TM: ['Russia'], KG: ['Russia'], SL: ['United Kingdom'], BF: ['France'],
  NA: ['South Africa', 'Germany'], ER: ['Ethiopia', 'Italy'],
  TL: ['Indonesia', 'Portugal'], PG: ['Australia', 'United Kingdom'],
  YE: ['Egypt', 'United Kingdom'], TG: ['France'],
  AF: ['Iran', 'Pakistan', 'United States', 'India'], GA: ['France'],
  FJ: ['United Kingdom', 'Australia', 'New Zealand', 'India'],
  MM: ['United Kingdom', 'India', 'Thailand'], KH: ['France', 'Thailand', 'Vietnam'],
  BD: ['Pakistan', 'India', 'United Kingdom'], NP: ['India'],
  MN: ['Russia', 'China'], LK: ['India', 'United Kingdom'],
  KP: ['South Korea', 'Russia', 'China'],
  TZ: ['United Kingdom', 'Kenya'], UG: ['United Kingdom', 'Kenya'],
  ML: ['France'], GN: ['France'], SD: ['United Kingdom', 'Egypt'],
  BJ: ['France'], CM: ['France'], SN: ['France'], ET: ['Italy', 'United Kingdom'],
  BZ: ['United Kingdom', 'United States'], GY: ['United Kingdom', 'United States'],
  HN: ['United States', 'Mexico'], BS: ['United States', 'United Kingdom'],
  SR: ['Netherlands'], HT: ['France', 'United States'], NI: ['United States', 'Mexico'],
}

/** Ruled individually Aug 10 (Naghma/Zarsanga/Tiam/Enayat) — skip. */
const ALREADY_RULED = new Set([
  'AF|dg|3547062', 'AF|dg|2248305', 'AF|wd|Q27895655', 'AF|wd|Q56359872',
])

/** Occupation/partition/exile classes — the owner rules these, not code. */
const PINNED_HELD = new Map([
  ['TL|dg|5103536', 'TL×Indonesia occupation era (Tonny Pereira)'],
  ['TL|dg|5264459', 'TL×Indonesia occupation era (Jerry Btn)'],
  ['KP|dg|5697431', 'Korea partition (김승연)'],
  ['NP|dg|4893434', 'Tibetan exile community on Nepali pressings'],
])

/** Wikidata country-QID ↔ the pool test; MB name for begin-area test. */
const MUSICAL_PROFESSIONS = new Set([
  'Q639669', 'Q177220', 'Q36834', 'Q488205', 'Q855091', 'Q2252262',
  'Q753110', 'Q158852', 'Q183945', 'Q128124', 'Q1259917', 'Q806349',
])

async function getJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      if (res.status === 429 || res.status === 503) {
        await sleep(3000 * attempt)
        continue
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await sleep(1200)
      return await res.json()
    } catch (error) {
      if (attempt === tries) throw error
      await sleep(2500 * attempt)
    }
  }
  return null
}

const areaCountryCache = new Map()

/** Walk an MB area up "part of" until a Country-type area; its name. */
async function areaToCountryName(areaId) {
  if (!areaId) return null
  if (areaCountryCache.has(areaId)) return areaCountryCache.get(areaId)
  let current = areaId
  let result = null
  for (let depth = 0; depth < 5 && current; depth++) {
    const body = await getJson(
      `https://musicbrainz.org/ws/2/area/${current}?fmt=json&inc=area-rels`,
    )
    if (!body) break
    if (body.type === 'Country') {
      result = body.name
      break
    }
    const parent = (body.relations ?? []).find(
      (relation) => relation.type === 'part of' && relation.direction === 'backward',
    )
    current = parent?.area?.id ?? null
  }
  areaCountryCache.set(areaId, result)
  return result
}

/** Origin claims for one Wikidata item, resolved to country QIDs. */
async function wikidataOrigin(qid) {
  const query = `SELECT ?desc ?born ?formed ?origin ?citizen ?prof WHERE {
  OPTIONAL { wd:${qid} schema:description ?desc . FILTER(LANG(?desc)='en') }
  OPTIONAL { wd:${qid} wdt:P19 ?bp . ?bp wdt:P17 ?born }
  OPTIONAL { wd:${qid} wdt:P740 ?fp . ?fp wdt:P17 ?formed }
  OPTIONAL { wd:${qid} wdt:P495 ?origin }
  OPTIONAL { wd:${qid} wdt:P27 ?citizen }
  OPTIONAL { wd:${qid} wdt:P106 ?prof }
}`
  const body = await getJson(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
  )
  if (!body) return null
  const qidOf = (row, key) => row[key]?.value.split('/').pop() ?? null
  const out = {
    description: null,
    born: null,
    formed: null,
    origin: null,
    citizenships: new Set(),
    professions: new Set(),
  }
  for (const row of body.results.bindings) {
    out.description ??= row.desc?.value ?? null
    out.born ??= qidOf(row, 'born')
    out.formed ??= qidOf(row, 'formed')
    out.origin ??= qidOf(row, 'origin')
    const citizen = qidOf(row, 'citizen')
    if (citizen) out.citizenships.add(citizen)
    const profession = qidOf(row, 'prof')
    if (profession) out.professions.add(profession)
  }
  return out
}

const GENERIC_WORDS = new Set([
  'rockets', 'sensations', 'vibrations', 'magnetics', 'magnificents',
  'heralds', 'citations', 'starlighters', 'hellions', 'love', 'willpower',
  'shango', 'elf', 'eon', 'urania', 'volumen', 'faucon', 'scipio',
  'prescott', 'nany', 'riny', 'dalia', 'gratia', 'enia', 'adani', 'amino',
  'fortu', 'akin', 'fuma', 'khayal', 'nasim', 'parwin', 'tenor', 'faty',
  'djibs', 'kilimanjaro', 'matata',
])

/** Crude first pass; the printed table gets a human audit before apply. */
function nameClass(name) {
  const stripped = name
    .toLowerCase()
    .replace(/^(the|los|las|les|el|la|le)\s+/, '')
    .trim()
  const tokens = stripped.split(/\s+/)
  if (tokens.length === 1 && (GENERIC_WORDS.has(tokens[0]) || tokens[0].length <= 4)) {
    return 'generic'
  }
  return 'distinctive'
}

function eraOverlap(entry, life) {
  if (!entry || entry.firstYear === null || !life?.begin) return null
  const begin = Number(String(life.begin).slice(0, 4)) || null
  if (!begin) return null
  const end =
    Number(String(life.end ?? '').slice(0, 4)) || (life.ended ? null : 2026)
  const last = entry.lastYear ?? entry.firstYear
  return entry.firstYear <= (end ?? 2026) && last >= begin
}

function findEntry(state, key) {
  const [kind, ...rest] = key.split('|')
  const id = rest.join('|')
  return (state.result ?? []).find((artist) =>
    kind === 'dg'
      ? String(artist.discogsArtistId) === id
      : kind === 'wd'
        ? artist.wikidataId === id
        : artist.name === id,
  )
}

function propose(kase) {
  if (kase.pinned) return { proposal: 'held', why: kase.pinned }
  const ev = kase.evidence
  if (ev.error) return { proposal: 'held', why: `evidence fetch failed: ${ev.error}` }
  const pool = COUNTRIES[kase.cc]
  const originQid = ev.wd?.origin ?? ev.wd?.formed ?? ev.wd?.born ?? null
  if (ev.wd?.citizenships?.includes(pool.qid) || originQid === pool.qid) {
    return { proposal: 'keep-note', why: 'origin/citizenship in pool country' }
  }
  if (originQid) {
    if (kase.wdIsCandidate) {
      return { proposal: 'exclude', why: `candidate's own Wikidata origin ${originQid} ≠ pool` }
    }
    if (kase.nameClass === 'distinctive' && kase.eraOverlap) {
      return { proposal: 'exclude', why: `MB match's Wikidata origin ${originQid} ≠ pool; identity via distinctive name + era` }
    }
    return { proposal: 'held', why: 'foreign origin on MB match but identity uncorroborated' }
  }
  if (ev.beginCountry) {
    if (ev.beginCountry === pool.mbArea) {
      return { proposal: 'keep-note', why: 'MB begin-area resolves into pool country (area is residence)' }
    }
    if (kase.nameClass === 'distinctive' && kase.eraOverlap) {
      return { proposal: 'exclude', why: `MB begin-area ${ev.beginCountry} ≠ pool; distinctive name + era` }
    }
  }
  if (kase.nameClass === 'generic') {
    return { proposal: 'keep-policy-c', why: 'generic name, no origin evidence — era coincidence is not identity' }
  }
  return { proposal: 'held', why: 'no corroboration either way' }
}

async function gather() {
  const work = JSON.parse(readFileSync(WORK_PATH, 'utf8'))
  const ruleWork = existsSync(RULE_WORK_PATH)
    ? JSON.parse(readFileSync(RULE_WORK_PATH, 'utf8'))
    : { cases: {} }

  const cases = []
  for (const [cc, state] of Object.entries(work.countries)) {
    if (cc === 'LA' || cc === 'PY' || !PARENT[cc]) continue
    for (const [key, verdict] of Object.entries(state.verdicts ?? {})) {
      if (verdict.verdict !== 'collision-kept') continue
      if (!PARENT[cc].includes(verdict.area)) continue
      const caseKey = `${cc}|${key}`
      if (ALREADY_RULED.has(caseKey)) continue
      const entry = findEntry(state, key)
      cases.push({
        caseKey, cc, key,
        name: entry?.name ?? verdict.mbName,
        mbid: verdict.mbid, mbName: verdict.mbName, mbArea: verdict.area,
        entryYears: entry ? [entry.firstYear, entry.lastYear] : null,
        wdIsCandidate: key.startsWith('wd|'),
        candidateWdId: key.startsWith('wd|') ? key.slice(3) : null,
        nameClass: nameClass(entry?.name ?? verdict.mbName),
        pinned: PINNED_HELD.get(caseKey) ?? null,
        missingInResult: !entry,
      })
    }
  }
  console.log(`${cases.length} cases compiled`)

  let done = 0
  for (const kase of cases) {
    const cached = ruleWork.cases[kase.caseKey]
    if (cached) {
      kase.evidence = cached
    } else {
      try {
        const evidence = { wd: null, beginCountry: null, life: null }
      const artist = await getJson(
        `https://musicbrainz.org/ws/2/artist/${kase.mbid}?fmt=json&inc=url-rels`,
      )
      if (artist) {
        evidence.life = artist['life-span'] ?? null
        const begin = artist['begin-area']?.id ?? null
        if (begin) evidence.beginCountry = await areaToCountryName(begin)
        const wdRel = (artist.relations ?? []).find(
          (relation) => relation.type === 'wikidata',
        )
        const wdQid =
          kase.candidateWdId ??
          wdRel?.url?.resource?.split('/').pop() ?? null
        if (wdQid) {
          const origin = await wikidataOrigin(wdQid)
          if (origin) {
            evidence.wd = {
              qid: wdQid,
              description: origin.description,
              born: origin.born, formed: origin.formed, origin: origin.origin,
              citizenships: [...origin.citizenships],
              professions: [...origin.professions],
              musician: [...origin.professions].some((p) =>
                MUSICAL_PROFESSIONS.has(p),
              ),
            }
          }
        }
      }
        ruleWork.cases[kase.caseKey] = evidence
        kase.evidence = evidence
      } catch (error) {
        // Not cached — a rerun retries it. If it keeps failing, the
        // case lands 'held' with the error disclosed, never a guess.
        kase.evidence = { wd: null, beginCountry: null, life: null, error: String(error) }
      }
      done++
      if (done % 10 === 0) {
        writeFileSync(RULE_WORK_PATH, JSON.stringify(ruleWork))
        console.log(`  ${done} gathered`)
      }
    }
    const entry = kase.entryYears
      ? { firstYear: kase.entryYears[0], lastYear: kase.entryYears[1] }
      : null
    kase.eraOverlap = eraOverlap(entry, kase.evidence.life)
    Object.assign(kase, propose(kase))
  }
  writeFileSync(RULE_WORK_PATH, JSON.stringify(ruleWork))
  writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: '2026-08-11', cases }, null, 2))
  const counts = {}
  for (const kase of cases) counts[kase.proposal] = (counts[kase.proposal] ?? 0) + 1
  console.log('proposals:', JSON.stringify(counts))
  console.log(`report → ${REPORT_PATH} (review before --apply)`)
}

async function apply() {
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
  const work = JSON.parse(readFileSync(WORK_PATH, 'utf8'))
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
  const summary = { excluded: [], noted: [], heldForOwner: [], keptPolicyC: 0 }

  for (const kase of report.cases) {
    const state = work.countries[kase.cc]
    const list = dataset.countries[kase.cc] ?? []
    const matches = (artist) =>
      kase.key.startsWith('dg|')
        ? String(artist.discogsArtistId) === kase.key.slice(3)
        : kase.key.startsWith('wd|')
          ? artist.wikidataId === kase.key.slice(3)
          : artist.name === kase.key.slice(3)
    if (kase.proposal === 'exclude') {
      dataset.countries[kase.cc] = list.filter((artist) => !matches(artist))
      state.result = (state.result ?? []).filter((artist) => !matches(artist))
      state.verdicts[kase.key] = {
        ...state.verdicts[kase.key],
        verdict: 'foreign-catalog',
        basis: `owner-ruling-pattern-b-foreign-origin (Aug 11 2026): ${kase.why}`,
      }
      summary.excluded.push(`${kase.cc} ${kase.name}`)
    } else if (kase.proposal === 'keep-note') {
      const note =
        `Owner ruling Aug 11 2026 (pattern a, metropole-residence): keep — ${kase.why}; ` +
        `MB ${kase.mbid} area=${kase.mbArea} recorded as residence-not-origin.`
      dataset.countries[kase.cc] = list.map((artist) =>
        matches(artist) && !artist.note ? { ...artist, note } : artist,
      )
      state.verdicts[kase.key] = {
        ...state.verdicts[kase.key],
        ownerRuling: `keep-with-note (pattern a, Aug 11 2026)`,
      }
      summary.noted.push(`${kase.cc} ${kase.name}`)
    } else if (kase.proposal === 'held') {
      summary.heldForOwner.push(`${kase.cc} ${kase.name}: ${kase.why}`)
    } else {
      summary.keptPolicyC++
    }
  }
  writeFileSync(DATASET_PATH, JSON.stringify(dataset, null, 2))
  writeFileSync(WORK_PATH, JSON.stringify(work))
  console.log(JSON.stringify(summary, null, 2))
  console.log(
    `dataset total now: ${Object.values(dataset.countries).reduce((sum, list) => sum + list.length, 0)}`,
  )
}

const mode = process.argv[2]
if (mode === '--gather') await gather()
else if (mode === '--apply') await apply()
else {
  console.error('Usage: node scripts/apply-pattern-ruling.mjs --gather | --apply')
  process.exit(1)
}
