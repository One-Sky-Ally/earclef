/**
 * Gap-fill play repair — EVIDENCE GATHERING FROM THE DISCOGS DUMP
 * (owner go, Sep 7, 2026: "the full sweep over all 22,094 — I want the
 * 10,688 that got a shallow check to get a real one").
 *
 *   node scripts/gather-extra-play-evidence-dump.mjs --smoke 100
 *   node scripts/gather-extra-play-evidence-dump.mjs            # everything
 *   node scripts/gather-extra-play-evidence-dump.mjs --unserved  # skip serving links
 *   node scripts/gather-extra-play-evidence-dump.mjs --only dg:3624572
 *   node scripts/gather-extra-play-evidence-dump.mjs --force     # regenerate dump-sourced files too
 *
 * SAME BAR, FULLER EVIDENCE. This writes the exact evidence files
 * scripts/gather-extra-play-evidence.mjs writes from the API, so
 * scripts/arbitrate-extra-play-identity.mjs and apply-extra-play-
 * identity.mjs run unchanged: anchor (whole-record credit / track
 * credit + title / linked channel) + corroboration (title / duration
 * ±3 s / MB title / Topic channel / name), exact whole-unit equality.
 * The difference is the records: the API walk fetched the first
 * RECORD_CAP=6 records at 55/min; the local videos-by-artist index
 * holds EVERY record the artist is credited on (main, track or extra
 * credit) that carries community videos — the "real check".
 *
 * What the dump cannot supply, stated: the original sweep's master-id
 * collision replay (a stored video that sits on no credited record is
 * `held: not-located-on-fetched-records`, never refuted here); track-
 * level extra credits (per-track featured roles) — the release-level
 * ones are present. Both err toward HELD, never toward serving.
 *
 * THIS SCRIPT DECIDES NOTHING. YouTube snippet/status/duration are the
 * only network calls (1 unit per 50 ids, shared cache). Resumable: a
 * file already sourced from the dump is skipped unless --force.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EVIDENCE_DIR, ROOT, env, evidencePath, videoIdOf, isoDurationSeconds,
  loadArtistsByKey, loadPlayEntries, discogsIdOf, channelIdsFromUrls,
} from './lib/extraPlayIdentity.mjs'
import { releaseGroupsFor, dumpSnapshot } from './lib/mbDumpIndex.mjs'
import {
  artistRecord, releasesMeta, videoIndexAvailable,
  videoReleaseRefsFor, videoReleaseShard, videoReleaseShardOf,
} from './lib/discogsDump.mjs'

const LOG_PATH = join(ROOT, 'data', 'extra-play-evidence-dump.log')
const YT_CACHE_PATH = join(EVIDENCE_DIR, 'youtube.json')
const LINKS_DIR = join(ROOT, 'data', 'mb-dump', 'artist-links')
const TRACKLIST_DIR = join(ROOT, 'data', 'mb-dump', 'rg-tracklists')
/** Candidates per artist — every one costs 1/50 of a YouTube unit. */
const CANDIDATE_CAP = 24
const YT_BATCH = 50

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : fallback
}
const SMOKE = Number(argOf('--smoke', 0))
const LIMIT = Number(argOf('--limit', Infinity))
const ONLY = argOf('--only', null)
const UNSERVED = process.argv.includes('--unserved')
const FORCE = process.argv.includes('--force')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  appendFileSync(LOG_PATH, `${stamped}\n`)
}

// ---- MusicBrainz crosswalk (copied from gather-extra-play-evidence.mjs,
// whose module runs its main() on import) ---------------------------------
function loadCrosswalk(discogsIds) {
  const wanted = new Set([...discogsIds].map(String))
  const byDiscogs = new Map()
  for (const file of readdirSync(LINKS_DIR)) {
    if (!file.endsWith('.jsonl')) continue
    for (const line of readFileSync(join(LINKS_DIR, file), 'utf8').split('\n')) {
      if (!line || !line.includes('"dg":')) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      for (const id of row.dg ?? []) {
        if (!wanted.has(id)) continue
        const held = byDiscogs.get(id) ?? []
        held.push({ mbid: row.a, name: row.n, youtube: row.yt ?? [] })
        byDiscogs.set(id, held)
      }
    }
  }
  return byDiscogs
}
const tracklistShards = new Map()
function tracklistTitlesFor(rgId) {
  const prefix = rgId.slice(0, 2)
  if (!tracklistShards.has(prefix)) {
    const map = new Map()
    const path = join(TRACKLIST_DIR, `${prefix}.jsonl`)
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue
        try { const row = JSON.parse(line); map.set(row.g, row.t ?? []) } catch { /* skip */ }
      }
    }
    tracklistShards.set(prefix, map)
  }
  return tracklistShards.get(prefix).get(rgId) ?? []
}
function musicbrainzEvidence(matches) {
  if (!matches || matches.length !== 1) {
    return matches?.length > 1 ? { ambiguous: matches.map((m) => m.mbid) } : null
  }
  const [{ mbid, name, youtube }] = matches
  const groups = releaseGroupsFor(mbid)
  const trackTitles = new Set()
  for (const group of groups) for (const title of tracklistTitlesFor(group.id)) trackTitles.add(title)
  return {
    mbid, name, youtube,
    channelIds: [...channelIdsFromUrls(youtube)],
    releaseGroupTitles: groups.map((group) => group.title),
    trackTitles: [...trackTitles],
  }
}

/** Same credit test as the API gatherer; ranks records for candidate order. */
function creditedOn(record, discogsId) {
  const id = Number(discogsId)
  if (record.artists.length && record.artists.every((a) => a.id === id)) return 'whole'
  if (record.artists.some((a) => a.id === id)) return 'shared'
  if (record.tracklist.some((t) => t.artists.includes(id))) return 'track'
  if (record.extraartists.some((a) => a.id === id)) return 'featured'
  return null
}
const CREDIT_RANK = { whole: 0, shared: 1, track: 2, featured: 3 }

// ---- YouTube metadata, shared cache ----------------------------------------
const youtubeCache = existsSync(YT_CACHE_PATH) ? JSON.parse(readFileSync(YT_CACHE_PATH, 'utf8')) : {}
let pending = []
let fetchFailures = 0
async function getJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (res.status === 429) { await sleep(8000); return getJson(url, attempt) }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (error) {
    if (attempt < 3) { await sleep(3000 * (attempt + 1)); return getJson(url, attempt + 1) }
    log(`  youtube fetch failed: ${error.message}`)
    fetchFailures++
    return null
  }
}
async function flushYoutube(key) {
  if (!pending.length) return
  const batch = pending.splice(0, YT_BATCH)
  const body = await getJson(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${batch.join(',')}&key=${key}`,
  )
  const seen = new Set()
  for (const item of body?.items ?? []) {
    seen.add(item.id)
    youtubeCache[item.id] = {
      channelId: item.snippet?.channelId ?? null,
      channelTitle: item.snippet?.channelTitle ?? null,
      title: item.snippet?.title ?? null,
      durationSeconds: isoDurationSeconds(item.contentDetails?.duration),
      privacyStatus: item.status?.privacyStatus ?? null,
      embeddable: item.status?.embeddable === true,
      fetchedAt: new Date().toISOString().slice(0, 10),
    }
  }
  if (body) for (const id of batch) if (!seen.has(id)) youtubeCache[id] = { gone: true }
  writeFileSync(YT_CACHE_PATH, JSON.stringify(youtubeCache, null, 1))
}

function fromDump(path) {
  try {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    return file.source === 'discogs-dump' && file.incomplete !== true
  } catch {
    return false
  }
}

async function main() {
  const ytKey = env('YOUTUBE_API_KEY')
  if (!ytKey) throw new Error('YOUTUBE_API_KEY required (.env.local)')
  if (!videoIndexAvailable()) throw new Error('videos-by-artist index missing — re-parse the dump with videos first')
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const edition = releasesMeta()?.source ?? 'dump'
  const artists = loadArtistsByKey()
  const entries = loadPlayEntries()

  // Universe: every dataset artist with a Discogs id whose play entry is
  // absent, null, or a YouTube link (kept or quarantined). Archive-kind
  // links (exact-creator IA matches, a different unbroken method) and
  // id-less entries are out of scope, as in the API gatherer.
  let universe = []
  let idless = 0, archive = 0
  for (const [key, held] of artists) {
    const entry = entries[key] ?? null
    const discogsId = discogsIdOf(held.artist, entry)
    if (!discogsId) { idless++; continue }
    if (entry?.play && entry.play.kind !== 'youtube-video') { archive++; continue }
    const serving = entry?.play?.kind === 'youtube-video' && !entry.identityUnverified
    if (UNSERVED && serving) continue
    universe.push([key, entry, held, discogsId])
  }
  if (ONLY) universe = universe.filter(([k]) => k === ONLY)
  else if (SMOKE) {
    const step = Math.max(1, Math.floor(universe.length / SMOKE))
    universe = universe.filter((_, i) => i % step === 0).slice(0, SMOKE)
  }
  log(`dump gather start: ${universe.length} artists in scope (${idless} id-less and ${archive} archive-kind skipped) · Discogs ${edition} · MB snapshot ${dumpSnapshot()?.snapshot ?? 'n/a'}`)
  const crosswalk = loadCrosswalk(universe.map(([, , , id]) => id))
  log(`crosswalk: ${crosswalk.size} Discogs ids linked by MusicBrainz`)

  // Pass 1 — which artists still need gathering, and which release ids
  // they need (artist shards are tiny). Pass 2 — load each release shard
  // ONCE and pull the records those artists need. Pass 3 — evidence.
  const todo = []
  let skipped = 0
  for (const [key, entry, held, discogsId] of universe) {
    if (todo.length >= LIMIT) break
    const path = evidencePath(key)
    if (!FORCE && existsSync(path) && fromDump(path)) { skipped++; continue }
    todo.push({ key, entry, held, discogsId, refs: videoReleaseRefsFor(discogsId) })
  }
  const needed = new Map()
  for (const item of todo) for (const ref of item.refs) {
    const shard = videoReleaseShardOf(ref.releaseId)
    ;(needed.get(shard) ?? needed.set(shard, new Set()).get(shard)).add(ref.releaseId)
  }
  const recordsById = new Map()
  let loaded = 0
  for (const [shard, ids] of needed) {
    const map = videoReleaseShard(shard)
    for (const id of ids) { const record = map.get(id); if (record) recordsById.set(id, record) }
    loaded++
    if (loaded % 32 === 0) log(`  release shards loaded ${loaded}/${needed.size} · records held ${recordsById.size}`)
  }
  log(`records resolved: ${recordsById.size} for ${todo.length} artists (${skipped} already dump-sourced)`)

  let done = 0
  const tally = { records: 0, credited: 0, candidates: 0, withCandidates: 0 }
  for (const { key, entry, held, discogsId, refs } of todo) {
    fetchFailures = 0
    const path = evidencePath(key)

    const dg = artistRecord(discogsId)
    const profile = dg
      ? { name: dg.name, realname: dg.realName ?? null, namevariations: dg.nameVariations ?? [], urls: dg.urls ?? [] }
      : null
    const records = refs
      .map((ref) => recordsById.get(ref.releaseId))
      .filter(Boolean)
      .map((record) => ({ ...record, listedRole: creditedOn(record, discogsId) }))
      .sort((a, b) => (CREDIT_RANK[a.listedRole] ?? 9) - (CREDIT_RANK[b.listedRole] ?? 9) || (a.year ?? 9999) - (b.year ?? 9999))
    const storedVideoId = entry?.play?.kind === 'youtube-video' ? videoIdOf(entry.play.url) : null
    const candidates = new Set(storedVideoId ? [storedVideoId] : [])
    for (const record of records) {
      if (!record.listedRole) continue
      for (const video of record.videos) if (candidates.size < CANDIDATE_CAP) candidates.add(video.videoId)
    }
    for (const id of candidates) if (!youtubeCache[id]) pending.push(id)
    while (pending.length >= YT_BATCH) await flushYoutube(ytKey)

    const credited = records.filter((r) => r.listedRole).length
    const evidence = {
      key,
      name: held.artist.name ?? entry?.name ?? null,
      countries: held.countries,
      bucket: !entry?.play ? 'null' : entry.identityUnverified ? 'quarantined' : 'kept',
      discogsId,
      storedVideoId,
      storedTitle: entry?.title ?? null,
      storedNotLocated: Boolean(storedVideoId) && !records.some((r) => r.videos.some((v) => v.videoId === storedVideoId)),
      datasetAliases: held.artist.aliases ?? [],
      profile,
      musicbrainz: musicbrainzEvidence(crosswalk.get(String(discogsId))),
      listedCount: records.length,
      records,
      candidateVideoIds: [...candidates],
      source: 'discogs-dump',
      edition,
      gatheredAt: new Date().toISOString(),
      ...(fetchFailures > 0 ? { incomplete: true, fetchFailures } : {}),
    }
    writeFileSync(path, JSON.stringify(evidence, null, 1))
    done++
    tally.records += records.length; tally.credited += credited; tally.candidates += candidates.size
    if (candidates.size) tally.withCandidates++
    if (done % 250 === 0) log(`  ${done} gathered · ${tally.withCandidates} with candidates · ${tally.candidates} candidate ids · youtube cache ${Object.keys(youtubeCache).length}`)
  }
  while (pending.length) await flushYoutube(ytKey)
  log(`dump gather done: ${done} artists gathered, ${skipped} already dump-sourced · records ${tally.records} (${tally.credited} credited) · ${tally.withCandidates} artists with candidates`)
}

main().catch((error) => {
  log(`FATAL: ${error.stack ?? error.message}`)
  process.exit(1)
})
