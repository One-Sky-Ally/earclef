/**
 * Gap-fill crosswalk audit — an automated FOREIGN-CATALOG LEAK DETECTOR
 * (owner-approved Aug 23, 2026: "the right use — evidence for the
 * held-ruling round, not links").
 *
 * The gap-fill dataset is, by construction, artists MusicBrainz has no
 * record of. So if MusicBrainz links an artist to the very Discogs page
 * a gap-fill entry carries, two independent databases agree on a NUMBER
 * — no names involved — that the entry IS an MB-known artist, i.e. the
 * dedup missed it. Every hit is then classified by MB's own area:
 *   foreign-catalog  — MB area is another country (Scott McKenzie in
 *                      Cambodia: the regional-pressing-circuit class)
 *   local-dedup-miss — MB area is the pool's country (a real local act
 *                      the dedup failed to merge)
 *   unplaced         — MB carries no area; the owner decides
 *
 * Usage: node scripts/audit-gapfill-crosswalk.mjs [--minutes 420]
 * Resumable via data/gapfill-crosswalk-work.json (gitignored); report to
 * data/gapfill-crosswalk-report.json (committed — ruling-round evidence).
 * MusicBrainz only, 1 req/1.1s, zero wallet. REPORT ONLY: nothing in the
 * dataset changes; the held-ruling round applies the decisions.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const GAPFILL_PATH = join(ROOT, 'lib', 'explore', 'extra-artists.json')
const WORK_PATH = join(ROOT, 'data', 'gapfill-crosswalk-work.json')
const REPORT_OUT = join(ROOT, 'data', 'gapfill-crosswalk-report.json')
const UA = 'EarClefCrosswalk/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const MB_DELAY_MS = 1100

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? Number(process.argv[index + 1]) : fallback
}
const MINUTES = argOf('--minutes', 420)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** 404 is a legitimate answer here (MB links nothing to this page). */
async function mbJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12000),
      })
      if (res.status === 404) return null
      if (res.status === 503 || res.status === 429) {
        await sleep(2500 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch (error) {
      if (attempt === 4) throw error
      await sleep(2500 * attempt)
    }
  }
  throw new Error('unreachable')
}

/** MB artists linked to a Discogs artist page — by URL, never by name. */
async function artistsLinkedTo(discogsArtistId) {
  const resource = encodeURIComponent(
    `https://www.discogs.com/artist/${discogsArtistId}`,
  )
  const body = await mbJson(
    `https://musicbrainz.org/ws/2/url?resource=${resource}&inc=artist-rels&fmt=json`,
  )
  await sleep(MB_DELAY_MS)
  if (!body) return []
  // Observed Aug 23: under load MB answered 200 WITHOUT a relations key.
  // Recording that as "no link" would be a silent false negative —
  // absent is not zero (lesson 5). Treat it as transient and retry.
  if (!('relations' in body)) {
    throw new Error('degraded MB response (no relations key)')
  }
  return body.relations
    .filter((relation) => relation.artist)
    .map((relation) => ({ mbid: relation.artist.id, name: relation.artist.name }))
}

async function artistFacts(mbid) {
  const body = await mbJson(`https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json`)
  await sleep(MB_DELAY_MS)
  if (!body) return null
  return {
    name: body.name,
    type: body.type ?? null,
    disambiguation: body.disambiguation ?? '',
    area: body.area?.name ?? null,
    areaCountry: body.area?.['iso-3166-1-codes']?.[0] ?? null,
    beginArea: body['begin-area']?.name ?? null,
    begin: body['life-span']?.begin ?? null,
  }
}

function classify(facts, poolCountry) {
  if (!facts.areaCountry) return 'unplaced'
  return facts.areaCountry === poolCountry ? 'local-dedup-miss' : 'foreign-catalog'
}

function writeReport(work, totals) {
  const hits = Object.values(work.results).filter((result) => result.matches.length)
  const byClass = {}
  for (const hit of hits) {
    for (const match of hit.matches) {
      byClass[match.class] = (byClass[match.class] ?? 0) + 1
    }
  }
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    method:
      'MB url lookup by discogs.com/artist/{id} → linked MB artists → MB area vs pool country. ID-level evidence only; no name matching anywhere.',
    totals: { ...totals, entriesChecked: Object.keys(work.results).length, entriesWithMbLink: hits.length },
    byClass,
    leaks: hits.flatMap((hit) =>
      hit.matches.map((match) => ({
        pool: hit.country,
        gapFillName: hit.name,
        discogsArtistId: hit.discogsArtistId,
        mbid: match.mbid,
        mbName: match.name,
        mbArea: match.area,
        mbAreaCountry: match.areaCountry,
        mbBeginArea: match.beginArea,
        mbDisambiguation: match.disambiguation,
        class: match.class,
      })),
    ),
  }
  writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2))
  return report
}

async function main() {
  const dataset = loadJson(GAPFILL_PATH, null)
  if (!dataset) throw new Error('gap-fill dataset missing')
  const entries = []
  for (const [country, list] of Object.entries(dataset.countries)) {
    for (const entry of list) {
      if (entry.discogsArtistId) {
        entries.push({ country, name: entry.name, discogsArtistId: entry.discogsArtistId })
      }
    }
  }
  const work = loadJson(WORK_PATH, { version: 1, results: {} })
  const pending = entries.filter(
    (entry) => !work.results[`${entry.country}|${entry.discogsArtistId}`],
  )
  const totals = { gapFillEntries: entries.length, withoutDiscogsId: 0 }
  for (const list of Object.values(dataset.countries)) {
    totals.withoutDiscogsId += list.filter((entry) => !entry.discogsArtistId).length
  }
  console.log(
    `${entries.length} entries carry a Discogs id · ${pending.length} to check · ` +
      `${totals.withoutDiscogsId} id-less entries cannot be crosswalked`,
  )

  const deadline = Date.now() + MINUTES * 60 * 1000
  let done = 0
  for (const entry of pending) {
    if (Date.now() > deadline) {
      console.log('— window closed')
      break
    }
    const key = `${entry.country}|${entry.discogsArtistId}`
    try {
      const linked = await artistsLinkedTo(entry.discogsArtistId)
      const matches = []
      for (const artist of linked) {
        const facts = await artistFacts(artist.mbid)
        if (!facts) continue
        matches.push({ ...artist, ...facts, class: classify(facts, entry.country) })
      }
      work.results[key] = { ...entry, matches }
    } catch (error) {
      console.warn(`  ${entry.country} ${entry.name}: ${error.message} (will retry)`)
      continue
    }
    done++
    if (done % 50 === 0) {
      writeFileSync(WORK_PATH, JSON.stringify(work))
      const hits = Object.values(work.results).filter((r) => r.matches.length).length
      console.log(`  ${done}/${pending.length} checked · ${hits} MB-linked so far`)
    }
  }
  writeFileSync(WORK_PATH, JSON.stringify(work))
  const report = writeReport(work, totals)
  console.log(JSON.stringify({ totals: report.totals, byClass: report.byClass }, null, 2))
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
