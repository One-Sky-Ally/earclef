/**
 * Held-ruling re-run (owner go, Aug 25, 2026) — standing lesson 8.
 *
 * The 176 held cases were never handed over raw. This pass re-derives
 * the queue against CURRENT state and against the gap-fill crosswalk's
 * ID-level evidence, resolves everything the data can resolve, and
 * hands the owner only what is genuinely their judgment.
 *
 * THE FINDING THAT SHAPES IT: the Aug-11 pass established identity by
 * NAME. The crosswalk (Discogs-page URL identity, no names anywhere)
 * disagrees with 20 of the 74 evidenced held cases — a ~27% error rate
 * on the name-matched identity leg. So this pass never trusts a
 * name-matched MBID as identity; it tests every one of them in both
 * directions:
 *   forward  — which MB artists link to OUR Discogs page (the crosswalk)
 *   reverse  — which Discogs page the CASE's MB artist links to (P1)
 * A different id in either direction disproves the collision outright.
 *
 * Phases:
 *   0  re-derive the queue locally (dropped entries, crosswalk join)
 *   1  reverse-URL check on every live held case MBID
 *   2  origin evidence for crosswalk MBIDs that differ from the case
 *   3  MIRROR CHECK on the 104 APPLIED exclusions — the only direction
 *      with irreversible cost, and the one the crosswalk could never
 *      see (excluded entries were removed from the dataset it reads)
 *   4  cross-pool consistency sweep (the real Amr Diab item)
 *   5  verbatim Discogs profile text attached to the residue
 *
 * Keeps are applied (a keep is the status quo — collision-kept already
 * ships). Exclusions and restorations are PROPOSED, never applied: the
 * finding of this pass is that the identity leg was weaker than
 * believed, so the destructive direction goes to the owner.
 *
 * Usage: node scripts/rerun-held-ruling.mjs [--phases 0,1,2,3,4,5]
 *                                           [--apply-keeps]
 * Resumable via data/held-rerun-work.json (gitignored).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'
import { discogsIdsFrom, discogsJson } from './lib/held-rerun-io.mjs'
import { gatherArtistEvidence, areaToCountry } from './lib/held-rerun-evidence.mjs'
import { mbJson } from './lib/held-rerun-io.mjs'

const PATHS = {
  ruling: 'data/pattern-ruling-report.json',
  overrides: 'data/pattern-ruling-overrides.json',
  crosswalk: 'data/gapfill-crosswalk-report.json',
  dataset: 'lib/explore/extra-artists.json',
  sweepWork: 'data/extra-artists-work-v2.json',
  work: 'data/held-rerun-work.json',
  report: 'data/held-ruling-rerun-report.json',
}

/** Owner-reserved history classes — evidence is attached, never acted on. */
const RESERVED = new Set([
  'TL|dg|5103536', 'TL|dg|5264459', 'KP|dg|5697431', 'NP|dg|4893434',
])
const RESERVED_AREAS = { PS: ['Israel'], XK: ['Serbia'] }

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : fallback
}
const PHASES = new Set(argOf('--phases', '0,1,2,3,4,5').split(','))
const APPLY_KEEPS = process.argv.includes('--apply-keeps')

const readJson = (path, fallback = null) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback

const work = readJson(PATHS.work, {
  version: 1, reverse: {}, origin: {}, mirror: {}, profiles: {},
})
const saveWork = () => writeFileSync(PATHS.work, JSON.stringify(work))
const areaCache = new Map()

/* ---------------------------------------------------------------- P0 */

function deriveQueue() {
  const ruling = readJson(PATHS.ruling)
  const dataset = readJson(PATHS.dataset)
  const crosswalk = readJson(PATHS.crosswalk)

  const crossIndex = new Map()
  for (const leak of crosswalk.leaks) {
    const key = `${leak.pool}|${String(leak.discogsArtistId)}`
    crossIndex.set(key, [...(crossIndex.get(key) ?? []), leak])
  }

  const held = ruling.cases.filter((kase) => kase.proposal === 'held')
  const live = []
  const dropped = []
  for (const kase of held) {
    const discogsId = kase.key.startsWith('dg|') ? kase.key.slice(3) : null
    const entry = (dataset.countries[kase.cc] ?? []).find(
      (artist) => String(artist.discogsArtistId) === discogsId,
    )
    if (!entry) {
      dropped.push({ ...kase, discogsId })
      continue
    }
    live.push({
      ...kase,
      discogsId,
      entryYears: [entry.firstYear ?? null, entry.lastYear ?? null],
      crosswalk: crossIndex.get(`${kase.cc}|${discogsId}`) ?? [],
      reserved:
        RESERVED.has(kase.caseKey) ||
        (RESERVED_AREAS[kase.cc] ?? []).includes(kase.mbArea),
    })
  }
  return { live, dropped, crossIndex }
}

/* ---------------------------------------------------------------- P1 */

async function reverseCheck(live) {
  const pending = live.filter((kase) => !work.reverse[kase.caseKey])
  console.log(`P1 reverse-URL check · ${pending.length} of ${live.length} to fetch`)
  let done = 0
  for (const kase of pending) {
    try {
      const evidence = await gatherArtistEvidence(kase.mbid, areaCache)
      work.reverse[kase.caseKey] = evidence.missing
        ? { missing: true }
        : {
            missing: false,
            mbName: evidence.name,
            discogsIds: discogsIdsFrom(evidence.relations),
            relCount: evidence.relations.length,
            beginCountry: evidence.beginCountry,
            areaCountry: evidence.areaCountry,
            wd: evidence.wd,
            life: evidence.life,
          }
    } catch (error) {
      console.warn(`  ${kase.cc} ${kase.name}: ${error.message} (retried next run)`)
      continue
    }
    done++
    if (done % 20 === 0) {
      saveWork()
      console.log(`  ${done}/${pending.length}`)
    }
  }
  saveWork()
}

/* ---------------------------------------------------------------- P2 */

async function crosswalkOrigins(live) {
  const wanted = new Set()
  for (const kase of live) {
    for (const leak of kase.crosswalk) {
      if (leak.mbid !== kase.mbid) wanted.add(leak.mbid)
    }
  }
  const pending = [...wanted].filter((mbid) => !work.origin[mbid])
  console.log(`P2 origin for crosswalk MBIDs · ${pending.length} of ${wanted.size} to fetch`)
  for (const mbid of pending) {
    try {
      const evidence = await gatherArtistEvidence(mbid, areaCache)
      work.origin[mbid] = evidence.missing
        ? { missing: true }
        : {
            missing: false,
            name: evidence.name,
            areaName: evidence.areaName,
            areaCountry: evidence.areaCountry,
            areaCountryName: evidence.areaCountryName,
            beginAreaName: evidence.beginAreaName,
            beginCountry: evidence.beginCountry,
            beginCountryCode: evidence.beginCountryCode,
            discogsIds: discogsIdsFrom(evidence.relations),
            wd: evidence.wd,
            life: evidence.life,
          }
      saveWork()
    } catch (error) {
      console.warn(`  ${mbid}: ${error.message} (retried next run)`)
    }
  }
  saveWork()
}

/* ---------------------------------------------------------------- P3 */

/** Every exclusion an owner ruling actually applied, from the sweep work file. */
function appliedExclusions() {
  const sweep = readJson(PATHS.sweepWork)
  const out = []
  for (const [cc, state] of Object.entries(sweep.countries ?? {})) {
    for (const [key, verdict] of Object.entries(state.verdicts ?? {})) {
      if (!verdict.basis || !/owner-ruling/.test(verdict.basis)) continue
      if (!key.startsWith('dg|')) continue
      out.push({
        cc, key,
        discogsId: key.slice(3),
        name: verdict.mbName ?? null,
        recordedMbid: verdict.mbid ?? null,
        recordedArea: verdict.area ?? null,
        basis: verdict.basis,
      })
    }
  }
  return out
}

async function mirrorCheck(exclusions) {
  const pending = exclusions.filter((row) => !work.mirror[`${row.cc}|${row.discogsId}`])
  console.log(`P3 MIRROR CHECK on applied exclusions · ${pending.length} of ${exclusions.length} to fetch`)
  let done = 0
  for (const row of pending) {
    const resource = encodeURIComponent(
      `https://www.discogs.com/artist/${row.discogsId}`,
    )
    try {
      const body = await mbJson(
        `https://musicbrainz.org/ws/2/url?resource=${resource}&inc=artist-rels&fmt=json`,
      )
      const relations = body ? body.relations : []
      if (body && !('relations' in body)) throw new Error('degraded MB response')
      const matches = []
      for (const relation of relations ?? []) {
        if (!relation.artist) continue
        const evidence = await gatherArtistEvidence(relation.artist.id, areaCache)
        if (evidence.missing) continue
        matches.push({
          mbid: relation.artist.id,
          name: evidence.name,
          areaName: evidence.areaName,
          areaCountry: evidence.areaCountry,
          beginCountry: evidence.beginCountry,
          beginCountryCode: evidence.beginCountryCode,
          disambiguation: evidence.disambiguation,
          wd: evidence.wd,
          discogsIds: discogsIdsFrom(evidence.relations),
        })
      }
      work.mirror[`${row.cc}|${row.discogsId}`] = { matches }
    } catch (error) {
      console.warn(`  ${row.cc} ${row.name}: ${error.message} (retried next run)`)
      continue
    }
    done++
    if (done % 10 === 0) {
      saveWork()
      console.log(`  ${done}/${pending.length}`)
    }
  }
  saveWork()
}

/* ---------------------------------------------------------------- P4 */

/** Discogs ids ruled out of one pool but still shipping in another. */
function crossPoolHoles(exclusions) {
  const dataset = readJson(PATHS.dataset)
  const sweep = readJson(PATHS.sweepWork)
  const ruledById = new Map()
  for (const row of exclusions) {
    ruledById.set(row.discogsId, [...(ruledById.get(row.discogsId) ?? []), row])
  }
  const holes = []
  for (const [discogsId, rulings] of ruledById) {
    const livePools = []
    for (const [cc, list] of Object.entries(dataset.countries)) {
      const entry = list.find((artist) => String(artist.discogsArtistId) === discogsId)
      if (!entry) continue
      const verdict = sweep.countries[cc]?.verdicts?.[`dg|${discogsId}`] ?? null
      livePools.push({
        cc,
        name: entry.name,
        years: [entry.firstYear ?? null, entry.lastYear ?? null],
        verdict: verdict?.verdict ?? null,
        basis: verdict?.basis ?? null,
      })
    }
    if (!livePools.length) continue
    // The origin rule is SUPPOSED to keep an artist in their own pool
    // while excluding them elsewhere (the Hamid El Shaeri tri-pool
    // proof). Parse the ruled origin QID and mark those consistent —
    // a hole is only a hole where the live pool is NOT the origin.
    const ruledQid = rulings
      .map((row) => /origin (Q\d+)/.exec(row.basis)?.[1] ?? null)
      .find(Boolean) ?? null
    const annotated = livePools.map((entry) => ({
      ...entry,
      consistentByOrigin: Boolean(ruledQid && COUNTRIES[entry.cc]?.qid === ruledQid),
    }))
    holes.push({
      discogsId,
      ruledOriginQid: ruledQid,
      ruledOutOf: rulings,
      stillLiveIn: annotated,
      inconsistent: annotated.some((entry) => !entry.consistentByOrigin),
    })
  }
  return holes
}

/* ---------------------------------------------------------------- P5 */

async function attachProfiles(cases) {
  const token = discogsToken()
  if (!token) {
    console.warn('P5 skipped — DISCOGS_TOKEN not in env')
    return
  }
  const pending = cases.filter((kase) => !work.profiles[kase.discogsId])
  console.log(`P5 Discogs profiles for residue · ${pending.length} of ${cases.length} to fetch`)
  let done = 0
  for (const kase of pending) {
    try {
      const body = await discogsJson(
        `https://api.discogs.com/artists/${kase.discogsId}`,
        token,
      )
      work.profiles[kase.discogsId] = body
        ? {
            name: body.name ?? null,
            realname: body.realname ?? null,
            profile: (body.profile ?? '').slice(0, 1500),
            aliases: (body.aliases ?? []).map((alias) => alias.name),
            members: (body.members ?? []).map((member) => member.name),
            groups: (body.groups ?? []).map((group) => group.name),
            urls: body.urls ?? [],
          }
        : { missing: true }
    } catch (error) {
      console.warn(`  dg ${kase.discogsId}: ${error.message} (retried next run)`)
      continue
    }
    done++
    if (done % 20 === 0) {
      saveWork()
      console.log(`  ${done}/${pending.length}`)
    }
  }
  saveWork()
}


/** DISCOGS_TOKEN out of .env.local (node does not read it for scripts). */
function discogsToken() {
  if (process.env.DISCOGS_TOKEN) return process.env.DISCOGS_TOKEN
  if (!existsSync('.env.local')) return null
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((row) => row.startsWith('DISCOGS_TOKEN='))
  return line ? line.slice('DISCOGS_TOKEN='.length).trim() : null
}

/* --------------------------------------------------------- apply keeps */

/**
 * Keeps only. A keep is the status quo — collision-kept already ships —
 * so this records the BASIS and nothing else changes shape. It can add
 * a note and rewrite a verdict's basis; it can never remove an entry.
 */
function applyKeeps(resolved) {
  const dataset = readJson(PATHS.dataset)
  const sweep = readJson(PATHS.sweepWork)
  let noted = 0
  for (const row of resolved) {
    const { cc, key, discogsId } = row.case
    const note =
      `Held-ruling re-run Aug 25 2026 (${row.decision.identity}): ${row.decision.why}`
    dataset.countries[cc] = (dataset.countries[cc] ?? []).map((artist) =>
      String(artist.discogsArtistId) === discogsId && !artist.note
        ? { ...artist, note }
        : artist,
    )
    const state = sweep.countries[cc]
    if (state?.verdicts?.[key]) {
      state.verdicts[key] = {
        ...state.verdicts[key],
        heldRerun: { outcome: row.decision.outcome, identity: row.decision.identity, why: row.decision.why },
      }
    }
    noted++
  }
  writeFileSync(PATHS.dataset, JSON.stringify(dataset, null, 2))
  writeFileSync(PATHS.sweepWork, JSON.stringify(sweep))
  const total = Object.values(dataset.countries).reduce((sum, list) => sum + list.length, 0)
  console.log(`applied ${noted} keeps · dataset total unchanged at ${total}`)
}

/* -------------------------------------------------------------- main */

async function main() {
  const { live, dropped } = deriveQueue()
  console.log(`P0 queue re-derived · ${live.length} live · ${dropped.length} no longer in the dataset`)

  if (PHASES.has('1')) await reverseCheck(live)
  if (PHASES.has('2')) await crosswalkOrigins(live)

  const exclusions = appliedExclusions()
  if (PHASES.has('3')) await mirrorCheck(exclusions)

  const { decide, classifyMirror } = await import('./lib/held-rerun-tree.mjs')

  const decided = live.map((kase) => ({
    case: kase,
    decision: decide(
      kase,
      work.reverse[kase.caseKey] ?? null,
      (mbid) => work.origin[mbid] ?? null,
      COUNTRIES[kase.cc],
    ),
  }))
  const bucket = (name) => decided.filter((row) => row.decision.outcome === name)

  const mirror = exclusions.map((row) => {
    const stored = work.mirror[`${row.cc}|${row.discogsId}`]
    if (!stored) return { ...row, verdict: 'not-checked', why: 'no result yet' }
    return { ...row, ...classifyMirror(row, stored.matches, COUNTRIES[row.cc]) }
  })

  const holes = PHASES.has('4') ? crossPoolHoles(exclusions) : []

  const residue = bucket('owner')
  if (PHASES.has('5')) await attachProfiles(residue.map((row) => row.case))

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    method:
      'Held cases re-derived against current state, then tested for identity in BOTH id directions ' +
      '(MB→our Discogs page via the crosswalk; case MBID→its own Discogs page). Origin rule unchanged; ' +
      'MB area is never read as origin. Keeps applied, exclusions and restorations proposed only.',
    queue: {
      heldAtHandover: 176,
      droppedFromDataset: dropped.map((kase) => `${kase.cc} ${kase.name} (${kase.key})`),
      live: live.length,
    },
    outcomes: {
      keep: bucket('keep').length,
      keepNote: bucket('keep-note').length,
      proposeExclude: bucket('propose-exclude').length,
      owner: residue.length,
    },
    resolved: [...bucket('keep'), ...bucket('keep-note')].map((row) => ({
      pool: row.case.cc, name: row.case.name, discogsId: row.case.discogsId,
      caseMbid: row.case.mbid, caseMbName: row.case.mbName, caseMbArea: row.case.mbArea,
      outcome: row.decision.outcome, identity: row.decision.identity,
      why: row.decision.why, evidence: row.decision.evidenceTrail,
    })),
    proposedExclusions: bucket('propose-exclude').map((row) => ({
      pool: row.case.cc, name: row.case.name, discogsId: row.case.discogsId,
      identity: row.decision.identity, why: row.decision.why, evidence: row.decision.evidenceTrail,
    })),
    mirrorCheck: {
      appliedExclusions: exclusions.length,
      checked: mirror.filter((row) => row.verdict !== 'not-checked').length,
      byVerdict: mirror.reduce(
        (acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }),
        {},
      ),
      wrongExclusionCandidates: mirror.filter((row) => row.verdict === 'WRONG-EXCLUSION-CANDIDATE'),
      differentIdentity: mirror.filter((row) => row.verdict === 'different-identity'),
      confirmed: mirror.filter((row) => row.verdict === 'confirmed').map((row) => `${row.cc} ${row.name}`),
      noMbLink: mirror.filter((row) => row.verdict === 'no-mb-link').map((row) => `${row.cc} ${row.name}`),
    },
    crossPoolHoles: holes,
    ownerResidue: residue.map((row) => ({
      pool: row.case.cc, name: row.case.name, discogsId: row.case.discogsId,
      years: row.case.entryYears,
      caseMbid: row.case.mbid, caseMbName: row.case.mbName, caseMbArea: row.case.mbArea,
      identity: row.decision.identity, why: row.decision.why,
      evidence: row.decision.evidenceTrail,
      discogsProfile: work.profiles[row.case.discogsId] ?? null,
    })),
  }
  writeFileSync(PATHS.report, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ queue: report.queue.live, outcomes: report.outcomes, mirror: report.mirrorCheck.byVerdict, crossPoolHoles: holes.length }, null, 2))
  console.log(`report → ${PATHS.report}`)

  if (APPLY_KEEPS) applyKeeps([...bucket('keep'), ...bucket('keep-note')])
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
