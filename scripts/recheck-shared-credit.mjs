/**
 * SHARED-CREDIT RE-CHECK (owner ruling, Oct 10, 2026): "a shared credit
 * counts only if the artist performed on that track, never on a
 * compilation. Links that fail move to held with their old video kept.
 * Nothing deleted."
 *
 *   node --env-file=.env.local scripts/recheck-shared-credit.mjs --gather   # Discogs detail, resumable
 *   node scripts/recheck-shared-credit.mjs                                  # judge → report (dry run)
 *   node scripts/recheck-shared-credit.mjs --write                          # apply the report's holds
 *
 * POPULATION: serving gap-fill links (lib/explore/extra-play.json, not
 * identityUnverified) whose identity anchors are ALL `shared` — the
 * 1,241 the Sep 27 audit counted. A link with any other anchor (whole,
 * track, featured, channel) stands on that anchor and is not touched.
 *
 * EVIDENCE: the records the serving video sits on where the artist is
 * a release-level credit beside others with no per-track artists — the
 * same test the arbitration used — read from the evidence cache, then
 * FULL Discogs detail per record (formats for the compilation test,
 * track-level and scoped release-level extra credits, which the dump
 * evidence lacks). Masters are judged by their main release. Detail is
 * cached in data/shared-credit-recheck/ (gitignored).
 *
 * RULE: lib/sharedCreditRule.mjs. A link passes if ANY of its shared
 * records passes. A link with a record whose detail could not be
 * fetched, and no passing record, is UNDECIDED and left exactly as it
 * is (missing evidence never reads as failing evidence).
 *
 * APPLY: a failing link keeps its play URL (and any previousPlay);
 * `identityUnverified: true` + `identityHeld: 'shared-credit-<reason>'`
 * stop it serving (queueEligible is kept); its identityEvidence moves, with the whole entry as
 * it was, into data/shared-credit-held.json. Idempotent; refuses to
 * write if anything but the held keys would change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aliasKeys, env, evidencePath, PLAY_PATH, ROOT, videoIdOf } from './lib/extraPlayIdentity.mjs'
import { getJson } from './lib/fetchJson.mjs'
import { sharedCreditVerdict } from './lib/sharedCreditRule.mjs'

const CACHE_DIR = join(ROOT, 'data', 'shared-credit-recheck')
const REPORT_PATH = join(ROOT, 'data', 'shared-credit-recheck-report.json')
const HELD_PATH = join(ROOT, 'data', 'shared-credit-held.json')
const GATHER = process.argv.includes('--gather')
const WRITE = process.argv.includes('--write')
const DG_UA = 'EarClef/0.1 +https://earclef.com'
/** Discogs authenticated ceiling is 60/min; stay under it. */
const DG_DELAY_MS = 1100

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const cachePath = (kind, id) => join(CACHE_DIR, `${kind}_${id}.json`)

function population(entries) {
  return Object.entries(entries).filter(([, entry]) => {
    const anchors = entry.identityEvidence?.anchors ?? []
    return entry.play?.kind === 'youtube-video' && !entry.identityUnverified &&
      anchors.length > 0 && anchors.every((anchor) => anchor === 'shared')
  })
}

/** The records this link's shared anchor rests on (same test as the arbitration). */
function sharedRecords(key, entry) {
  const path = evidencePath(key)
  if (!existsSync(path)) return { evidence: null, records: [] }
  const evidence = readJson(path)
  const id = Number(evidence.discogsId)
  const videoId = videoIdOf(entry.play.url)
  const records = evidence.records.filter((record) =>
    !record.replayOfMasterId &&
    record.videos.some((video) => video.videoId === videoId) &&
    record.artists.some((artist) => artist.id === id) &&
    !record.artists.every((artist) => artist.id === id) &&
    !record.tracklist.some((track) => track.artists.length > 0))
  return { evidence, records }
}

/** Only what the rule reads, so the cache stays small. */
const detailOf = (body) => ({
  id: body.id,
  title: body.title,
  formats: (body.formats ?? []).map(({ name, descriptions }) => ({ name, descriptions: descriptions ?? [] })),
  // `join` is what separates joint credits ("A & B") from splits ("A / B").
  artists: (body.artists ?? []).map(({ id, name, join }) => ({ id, name, join: join ?? '' })),
  joinsKnown: true,
  extraartists: (body.extraartists ?? []).map(({ id, name, role, tracks }) => ({ id, name, role, tracks: tracks ?? '' })),
  tracklist: (body.tracklist ?? []).map(trackOf),
})

/** A tracklist row, with a medley's sub-tracks kept (the rule ties videos to them). */
function trackOf({ position, title, duration, type_, artists, extraartists, sub_tracks: subTracks }) {
  return {
    position, title, duration, type_,
    artists: (artists ?? []).map(({ id, name }) => ({ id, name })),
    extraartists: (extraartists ?? []).map(({ id, name, role }) => ({ id, name, role })),
    ...(subTracks?.length ? { sub_tracks: subTracks.map(trackOf) } : {}),
  }
}

async function fetchDetail(kind, id, token) {
  const headers = { 'User-Agent': DG_UA }
  if (kind === 'master') {
    const master = await getJson(`https://api.discogs.com/masters/${id}?token=${token}`, headers, { tries: 4, backoffMs: 3000 })
    await sleep(DG_DELAY_MS)
    if (!master.main_release) throw new Error(`master ${id} has no main release`)
    const release = await getJson(`https://api.discogs.com/releases/${master.main_release}?token=${token}`, headers, { tries: 4, backoffMs: 3000 })
    return { ...detailOf(release), viaMaster: id }
  }
  return detailOf(await getJson(`https://api.discogs.com/releases/${id}?token=${token}`, headers, { tries: 4, backoffMs: 3000 }))
}

async function gather(links) {
  const token = env('DISCOGS_TOKEN')
  if (!token) throw new Error('DISCOGS_TOKEN missing — run with --env-file=.env.local')
  mkdirSync(CACHE_DIR, { recursive: true })
  const wanted = new Map()
  for (const [key, entry] of links) {
    for (const record of sharedRecords(key, entry).records) wanted.set(`${record.kind}_${record.id}`, record)
  }
  // A cached detail written before joins were kept is fetched again.
  const stale = (path) => !existsSync(path) || readJson(path).joinsKnown !== true
  const todo = [...wanted.values()].filter((record) => stale(cachePath(record.kind, record.id)))
  console.log(`gather: ${wanted.size} shared records, ${todo.length} still to fetch`)
  let failed = 0
  for (const [index, record] of todo.entries()) {
    try {
      writeFileSync(cachePath(record.kind, record.id), JSON.stringify(await fetchDetail(record.kind, record.id, token)))
    } catch (error) {
      failed++
      console.warn(`  ${record.kind} ${record.id}: ${error.message} — a rerun retries it`)
    }
    if ((index + 1) % 100 === 0) console.log(`  ${index + 1}/${todo.length}`)
    await sleep(DG_DELAY_MS)
  }
  console.log(`gather done: ${todo.length - failed} fetched, ${failed} failed`)
}

function judge(links) {
  const rows = []
  for (const [key, entry] of links) {
    const { evidence, records } = sharedRecords(key, entry)
    if (!evidence || records.length === 0) {
      rows.push({ key, decision: 'undecided', reason: evidence ? 'no-shared-record-found' : 'no-evidence-file', title: entry.title ?? null })
      continue
    }
    const aliases = aliasKeys({ name: evidence.name ?? '', aliases: evidence.datasetAliases }, evidence.profile, evidence.musicbrainz?.name)
    const perRecord = records.map((record) => {
      const path = cachePath(record.kind, record.id)
      // Detail without joins could not show a joint credit — it counts as not fetched.
      const detail = existsSync(path) ? readJson(path) : null
      if (!detail?.joinsKnown) return { record: `${record.kind} ${record.id}`, unfetched: true }
      const verdict = sharedCreditVerdict({
        artistId: evidence.discogsId,
        record: detail,
        uploadTitle: entry.title ?? '',
        durationSeconds: entry.durationSeconds ?? null,
        aliases,
      })
      return { record: `${record.kind} ${record.id}`, title: detail.title, credits: detail.artists.map((a) => a.name), ...verdict }
    })
    const passing = perRecord.find((row) => row.pass)
    const decision = passing ? 'pass' : perRecord.some((row) => row.unfetched) ? 'undecided' : 'hold'
    rows.push({
      key,
      artist: evidence.name ?? null,
      countries: evidence.countries ?? [],
      title: entry.title ?? null,
      url: entry.play.url,
      decision,
      reason: decision === 'hold' ? perRecord[0].reason : passing?.via ?? 'unfetched-record',
      looseReadingPass: perRecord.some((row) => row.looseReadingPass),
      records: perRecord,
    })
  }
  return rows
}

function tally(rows, field) {
  const counts = {}
  for (const row of rows) counts[row[field]] = (counts[row[field]] ?? 0) + 1
  return counts
}

function apply(dataset, rows) {
  const entries = dataset.entries
  const holds = rows.filter((row) => row.decision === 'hold')
  const held = existsSync(HELD_PATH) ? readJson(HELD_PATH).cases : []
  const already = new Set(held.map((item) => item.key))
  const next = { ...entries }
  const added = []
  for (const row of holds) {
    const before = entries[row.key]
    if (already.has(row.key) || before.identityUnverified) continue
    // queueEligible stays: if a hold is ever lifted, the short-clip guard must still be there.
    const kept = Object.fromEntries(Object.entries(before).filter(([field]) => field !== 'identityEvidence'))
    next[row.key] = { ...kept, identityUnverified: true, identityHeld: `shared-credit-${row.reason}` }
    added.push({ ...row, entryBefore: before })
  }
  // Guards: only the held keys change, every key survives, URLs stay.
  const keys = Object.keys(entries)
  if (keys.length !== Object.keys(next).length) throw new Error('key count changed — refusing to write')
  const touched = new Set(added.map((item) => item.key))
  for (const key of keys) {
    if (touched.has(key)) {
      if (next[key].play?.url !== entries[key].play?.url) throw new Error(`${key}: play URL changed — refusing to write`)
    } else if (next[key] !== entries[key]) {
      throw new Error(`${key}: changed without a hold — refusing to write`)
    }
  }
  return { next, added, held }
}

async function main() {
  const dataset = readJson(PLAY_PATH)
  // Links this rule already held are judged again from the entry as it
  // was, so a rerun's report still covers the whole population.
  const alreadyHeld = existsSync(HELD_PATH)
    ? readJson(HELD_PATH).cases.map((item) => [item.key, item.entryBefore])
    : []
  const links = [...population(dataset.entries), ...alreadyHeld]
  console.log(`population: ${links.length} links anchored only on a shared credit (${alreadyHeld.length} already held by this rule)`)
  if (GATHER) {
    await gather(links)
    return
  }
  const rows = judge(links)
  const holds = rows.filter((row) => row.decision === 'hold')
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ruling: 'Owner, Oct 10 2026: "a shared credit counts only if the artist performed on that track, never on a compilation. Links that fail move to held with their old video kept. Nothing deleted."',
    population: links.length,
    decisions: tally(rows, 'decision'),
    passVia: tally(rows.filter((row) => row.decision === 'pass'), 'reason'),
    holdReasons: tally(holds, 'reason'),
    holdsThatPassTheLooseReading: holds.filter((row) => row.looseReadingPass).length,
    looseReadingNote: 'loose reading = a release-level credit is inherited by every track that names no artist of its own (still never on a compilation, still tied to a track)',
    rows,
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1))
  console.log(JSON.stringify({ decisions: report.decisions, passVia: report.passVia, holdReasons: report.holdReasons, holdsThatPassTheLooseReading: report.holdsThatPassTheLooseReading }))
  if (!WRITE) {
    console.log(`dry run → ${REPORT_PATH} (nothing applied; --write applies the holds)`)
    return
  }
  const { next, added, held } = apply(dataset, rows)
  if (added.length === 0) {
    console.log('applied: nothing new to hold')
    return
  }
  // The held file FIRST: if the dataset write then fails, every entry is
  // still exactly as it was, and its saved copy already exists.
  writeFileSync(HELD_PATH, JSON.stringify({
    generatedAt: report.generatedAt,
    ruling: report.ruling,
    note: 'Each case keeps the entry exactly as it was (entryBefore) — restoring one is putting entryBefore back.',
    total: held.length + added.length,
    cases: [...held, ...added],
  }, null, 1))
  writeFileSync(PLAY_PATH, `${JSON.stringify({ ...dataset, generatedAt: report.generatedAt, entries: next }, null, 2)}\n`)
  console.log(`applied: ${added.length} links moved to held (${held.length} were already held) → ${HELD_PATH}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
