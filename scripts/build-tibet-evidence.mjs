/**
 * Tibet pilot — evidence pass (owner go, Aug 27, 2026).
 *
 * Gathers CANDIDATES for the Tibet claimed-place roster and fetches
 * per-artist evidence against the SELF-IDENTIFICATION-ONLY bar:
 * ascription, genre tags and language are never sufficient alone; the
 * artist's own naming/profile/materials are what count. Verdicts here
 * are PROPOSALS — the roster ships only after the owner reviews the
 * report (thin cases held, never guessed).
 *
 * ROSTER EVENNESS (owner-ruled): PRC-system Tibetan artists and exile
 * artists qualify under the identical bar; the report measures the
 * composition skew rather than papering over it.
 *
 * Sources: MB area (MB names it Xizang; the site displays Tibet — the
 * principle applied literally), MB comment/tag pools, seed names.
 * Resumable via data/tibet-evidence-work.json (gitignored); report to
 * data/tibet-evidence-report.json (committed). Zero wallet.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mbJson, discogsJson, discogsIdsFrom } from './lib/held-rerun-io.mjs'
import { gatherArtistEvidence } from './lib/held-rerun-evidence.mjs'

const WORK_PATH = 'data/tibet-evidence-work.json'
const REPORT_PATH = 'data/tibet-evidence-report.json'

/** Known-identity seeds by MBID — the founding case first. */
const SEED_MBIDS = []
{
  const rep = JSON.parse(readFileSync('data/pattern-ruling-report.json', 'utf8'))
  const rangzen = rep.cases.find((c) => c.caseKey === 'NP|dg|4893434')
  if (rangzen?.mbid) SEED_MBIDS.push(rangzen.mbid)
}

const SEED_NAMES = [
  'Techung', 'Yungchen Lhamo', 'Nawang Khechog', 'Loten Namling',
  'Phurbu T. Namgyal', 'Tenzin Choegyal', 'Dechen Shak-Dagsay',
  'Ani Choying Drolma', '才旦卓玛', 'Sherten', 'Kelsang Metok',
  'JJI Exile Brothers', 'Tibetan Institute of Performing Arts',
]

const work = existsSync(WORK_PATH)
  ? JSON.parse(readFileSync(WORK_PATH, 'utf8'))
  : { candidates: {}, evidence: {}, done: {} }
const saveWork = () => writeFileSync(WORK_PATH, JSON.stringify(work))
const areaCache = new Map()

function addCandidate(artist, source) {
  const existing = work.candidates[artist.id]
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source)
    return
  }
  work.candidates[artist.id] = {
    mbid: artist.id,
    name: artist.name,
    type: artist.type ?? null,
    areaName: artist.area?.name ?? null,
    disambiguation: artist.disambiguation ?? '',
    life: artist['life-span'] ?? null,
    tags: (artist.tags ?? []).filter((t) => (t.count ?? 0) > 0).map((t) => t.name.toLowerCase()),
    sources: [source],
  }
}

async function collectQuery(label, query) {
  if (work.done[label]) return
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&limit=100&offset=${offset}&fmt=json`,
      'artists',
    )
    total = body.count ?? 0
    for (const artist of body.artists ?? []) addCandidate(artist, label)
    offset += 100
  }
  work.done[label] = true
  saveWork()
  console.log(`  ${label}: candidates now ${Object.keys(work.candidates).length}`)
}

async function collectSeeds() {
  if (work.done.seeds) return
  for (const name of SEED_NAMES) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&limit=3&fmt=json`,
      'artists',
    )
    // Exact-name hits only — a seed is a lead, not an identity claim;
    // phase-2 evidence still decides everything.
    for (const artist of (body.artists ?? []).filter(
      (a) => a.name.toLowerCase() === name.toLowerCase() || (a.score ?? 0) === 100,
    ).slice(0, 1)) {
      addCandidate(artist, 'seed')
    }
  }
  for (const mbid of SEED_MBIDS) {
    if (work.candidates[mbid]) { work.candidates[mbid].sources.push('seed'); continue }
    const body = await mbJson(`https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json`)
    if (body) addCandidate(body, 'seed')
  }
  work.done.seeds = true
  saveWork()
  console.log(`  seeds: candidates now ${Object.keys(work.candidates).length}`)
}

function discogsToken() {
  if (process.env.DISCOGS_TOKEN) return process.env.DISCOGS_TOKEN
  const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith('DISCOGS_TOKEN='))
  return line ? line.slice('DISCOGS_TOKEN='.length).trim() : null
}

async function gatherEvidence() {
  const token = discogsToken()
  const pending = Object.keys(work.candidates).filter((mbid) => !work.evidence[mbid])
  console.log(`evidence: ${pending.length} of ${Object.keys(work.candidates).length} to fetch`)
  let done = 0
  for (const mbid of pending) {
    try {
      const ev = await gatherArtistEvidence(mbid, areaCache)
      const row = {
        missing: ev.missing ?? false,
        beginCountry: ev.beginCountry ?? null,
        areaCountry: ev.areaCountry ?? null,
        areaCountryName: ev.areaCountryName ?? null,
        wdDescription: ev.wd?.description ?? null,
        wdCitizenships: ev.wd?.citizenships ?? [],
        officialSites: (ev.relations ?? [])
          .filter((r) => r.type === 'official homepage')
          .map((r) => r.url?.resource)
          .filter(Boolean),
        discogsIds: discogsIdsFrom(ev.relations ?? []),
        discogsProfile: null,
      }
      if (row.discogsIds[0] && token) {
        const dg = await discogsJson(
          `https://api.discogs.com/artists/${row.discogsIds[0]}`,
          token,
        ).catch(() => null)
        if (dg) row.discogsProfile = (dg.profile ?? '').slice(0, 600) || null
      }
      work.evidence[mbid] = row
    } catch (error) {
      console.warn(`  ${work.candidates[mbid].name}: ${error.message} (retried next run)`)
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

/**
 * The bar, encoded. Strong = the artist's own materials carry the
 * claim (Discogs profile text is artist-adjacent; official site
 * recorded as a pointer, never fetched). Corroborated = two or more
 * independent descriptors. One descriptor = held-thin. Zero = out.
 */
function propose(candidate, evidence) {
  const texts = [
    ['discogs-profile', evidence?.discogsProfile],
    ['wd-description', evidence?.wdDescription],
    ['mb-disambiguation', candidate.disambiguation],
  ]
  const hits = texts.filter(([, t]) => t && /tibet/i.test(t)).map(([k]) => k)
  // Own naming carries the claim (the approved bar names it) — one
  // descriptor, never auto-strong: a new-age act CALLED "Tibetan
  // Bells" may be appropriation, not identity; combination decides.
  if (/tibet|rangzen/i.test(candidate.name)) hits.push('self-naming')
  const tagHit =
    candidate.tags.includes('tibetan') || candidate.sources.includes('mb-tag')
  if (tagHit) hits.push('mb-tag')
  const areaHit = /xizang|tibet/i.test(candidate.areaName ?? '')
  if (areaHit) hits.push('mb-area')
  const profileStrong = evidence?.discogsProfile && /tibetan/i.test(evidence.discogsProfile)
  let verdict = profileStrong || hits.length >= 2
    ? 'include-proposed'
    : hits.length === 1
      ? 'held-thin'
      : 'reject-no-evidence'
  // A seed with zero machine evidence is a LEAD, not a reject.
  if (verdict === 'reject-no-evidence' && candidate.sources.includes('seed')) {
    verdict = 'held-thin'
  }
  // FILING location only — where the databases put them, never which
  // "system" the artist belongs to (Yungchen Lhamo is filed under
  // Tibet and fled it; filing is not allegiance).
  const wing =
    areaHit || evidence?.areaCountry === 'CN'
      ? 'tibet-area-filed'
      : ['IN', 'NP', 'US', 'CH', 'AU', 'GB', 'CA'].includes(evidence?.areaCountry ?? '') ||
          ['India', 'Nepal', 'United States', 'Switzerland', 'Australia'].includes(evidence?.beginCountry ?? '')
        ? 'diaspora-filed'
        : 'unplaced'
  return { verdict, evidenceKeys: hits, wing }
}

async function main() {
  await collectQuery('mb-area', 'area:"Tibet Autonomous Region"')
  await collectQuery('mb-comment', 'comment:tibetan')
  await collectQuery('mb-tag', 'tag:tibetan')
  await collectSeeds()
  await gatherEvidence()

  const rows = Object.values(work.candidates).map((candidate) => {
    const evidence = work.evidence[candidate.mbid] ?? null
    return { ...candidate, evidence, ...propose(candidate, evidence) }
  })
  const byVerdict = {}
  const byWing = {}
  for (const row of rows) {
    byVerdict[row.verdict] = (byVerdict[row.verdict] ?? 0) + 1
    if (row.verdict === 'include-proposed') byWing[row.wing] = (byWing[row.wing] ?? 0) + 1
  }
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    bar: 'self-identification only — ascription, genre tags and language never sufficient alone; verdicts are PROPOSALS pending owner review; thin cases held',
    byVerdict,
    includeSkew: byWing,
    rows: rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name)),
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1))
  console.log(JSON.stringify({ byVerdict, includeSkew: byWing }, null, 1))
  console.log(`report → ${REPORT_PATH}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
