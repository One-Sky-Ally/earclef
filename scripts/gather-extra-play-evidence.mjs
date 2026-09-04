/**
 * Gap-fill play repair — STEP 1, EVIDENCE GATHERING (owner go, Sep 3 2026).
 *
 *   node scripts/gather-extra-play-evidence.mjs --smoke 150
 *   node scripts/gather-extra-play-evidence.mjs --minutes 420   # nightly
 *   node scripts/gather-extra-play-evidence.mjs --only dg:3624572
 *
 * WHY: the original sweep (build-extra-play.mjs) bound a video to an
 * artist by release-attachment alone, and had a second defect found
 * Sep 3: `/artists/{id}/releases` rows can be MASTERS, and their ids
 * were fetched as `/releases/{id}` — a different number space — so the
 * walk landed on unrelated records (Rage Mob → Erasmo Carlos 1966). A
 * 14-link sample split 9 master-id / 4 compilation / 1 correct.
 *
 * THIS SCRIPT DECIDES NOTHING. Per artist with a committed YouTube
 * link it fetches and caches, verbatim, the records that carry
 * identity evidence: the Discogs artist profile (aliases, urls), the
 * artist's own records walked CORRECTLY (masters via /masters, their
 * main release when the master carries no videos), each record's
 * structured credits, tracklist with per-track credits and durations,
 * and attached videos; YouTube snippet/status/duration for the stored
 * video and every candidate on a credited record; and, offline, the
 * MusicBrainz crosswalk (Discogs id → exactly one MB artist) with that
 * artist's release-group titles, tracklist titles and channel links.
 * scripts/arbitrate-extra-play-identity.mjs rules on the cache.
 *
 * COST: Discogs ~6 calls/artist typical (14 worst) at 60/min; YouTube
 * 1 unit per 50 ids. MUST NOT run concurrently with any other Discogs
 * sweep (same budget → 429s for both). Resumable: one JSON per artist
 * under data/extra-play-evidence/ (gitignored); youtube.json cache.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EVIDENCE_DIR, ROOT, env, evidencePath, videoIdOf, isoDurationSeconds,
  loadArtistsByKey, loadPlayEntries, discogsIdOf, channelIdsFromUrls,
} from './lib/extraPlayIdentity.mjs'
import { releaseGroupsFor, dumpSnapshot } from './lib/mbDumpIndex.mjs'

const UA = 'EarClefExtraPlay/0.2 (https://earclef.com; fiohmemorial@gmail.com)'
const LOG_PATH = join(ROOT, 'data', 'extra-play-identity.log')
const YT_CACHE_PATH = join(EVIDENCE_DIR, 'youtube.json')
const LINKS_DIR = join(ROOT, 'data', 'mb-dump', 'artist-links')
const TRACKLIST_DIR = join(ROOT, 'data', 'mb-dump', 'rg-tracklists')
const DISCOGS_DELAY_MS = 1100
const RECORD_CAP = 6
const CANDIDATE_CAP = 12
const YT_BATCH = 50

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : fallback
}
const SMOKE = Number(argOf('--smoke', 0))
const LIMIT = Number(argOf('--limit', Infinity))
const MINUTES = Number(argOf('--minutes', Infinity))
const ONLY = argOf('--only', null)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  appendFileSync(LOG_PATH, `${stamped}\n`)
}

async function getJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (res.status === 429) {
      await sleep(8000)
      return getJson(url, attempt)
    }
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (error) {
    if (attempt < 3) {
      await sleep(3000 * (attempt + 1))
      return getJson(url, attempt + 1)
    }
    log(`  fetch failed ${url.replace(/token=[^&]+/, 'token=…').slice(0, 100)}: ${error.message}`)
    fetchFailures++
    return null
  }
}

/**
 * Failures inside one artist's gather (a sleeping Mac, a network blip)
 * leave that artist's evidence INCOMPLETE. Such a file is written with
 * `incomplete: true` and treated as not done on resume — missing
 * records must never read as "no records" (standing lesson 5).
 */
let fetchFailures = 0
function isComplete(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).incomplete !== true
  } catch {
    return false
  }
}

async function discogs(path, token) {
  const body = await getJson(`https://api.discogs.com${path}${path.includes('?') ? '&' : '?'}token=${token}`)
  await sleep(DISCOGS_DELAY_MS)
  return body
}

/** Discogs id → MB artist ids (only artists whose links carry that id). */
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

/** Local MB evidence for a crosswalked artist — titles + channel links. */
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

function shapeRecord(kind, row, detail) {
  return {
    kind,
    id: detail.id,
    listedRole: row?.role ?? null,
    title: detail.title ?? '',
    year: detail.year ?? null,
    mainRelease: detail.main_release ?? null,
    artists: (detail.artists ?? []).map((a) => ({ id: a.id, name: a.name, anv: a.anv ?? '' })),
    /** Featured / performer credits: ID-level, weaker than the main credit. */
    extraartists: (detail.extraartists ?? []).map((a) => ({ id: a.id, name: a.name, role: a.role ?? '' })),
    tracklist: (detail.tracklist ?? []).map((t) => ({
      position: t.position ?? '',
      title: t.title ?? '',
      duration: t.duration ?? '',
      artists: (t.artists ?? []).map((a) => a.id),
      extraartists: (t.extraartists ?? []).map((a) => ({ id: a.id, role: a.role ?? '' })),
    })),
    videos: (detail.videos ?? [])
      .map((v) => ({ videoId: videoIdOf(v.uri), title: v.title ?? '', duration: v.duration ?? null }))
      .filter((v) => v.videoId),
  }
}

/** The corrected walk: Main-role first, masters through /masters. */
async function gatherRecords(discogsId, token) {
  const list = await discogs(`/artists/${discogsId}/releases?per_page=100`, token)
  const rows = (list?.releases ?? []).filter((r) => r?.id)
  const roleRank = (r) => (r.role === 'Main' ? 0 : r.role === 'TrackAppearance' ? 1 : 2)
  rows.sort((a, b) => roleRank(a) - roleRank(b))
  const records = []
  for (const row of rows.slice(0, RECORD_CAP)) {
    if (row.type === 'master') {
      const master = await discogs(`/masters/${row.id}`, token)
      if (!master) continue
      records.push(shapeRecord('master', row, master))
      if (!(master.videos ?? []).length && master.main_release) {
        const main = await discogs(`/releases/${master.main_release}`, token)
        if (main) records.push(shapeRecord('release', { role: row.role }, main))
      }
    } else {
      const release = await discogs(`/releases/${row.id}`, token)
      if (release) records.push(shapeRecord('release', row, release))
    }
  }
  return { listedCount: list?.pagination?.items ?? rows.length, records, masterRows: rows.slice(0, 4).filter((r) => r.type === 'master') }
}

/**
 * Replay the original sweep's defect for a stored video the correct
 * walk could not locate: it fetched `/releases/{masterId}`. If that
 * unrelated record carries the stored video, the link is EXPLAINED
 * (and refutable) rather than merely unlocated. Bounded to the first
 * four masters, the original walk's own cap; stops at the first hit.
 */
async function replayMasterCollision(masterRows, storedVideoId, token) {
  for (const row of masterRows) {
    const release = await discogs(`/releases/${row.id}`, token)
    if (!release) continue
    const record = shapeRecord('release', { role: null }, release)
    if (record.videos.some((v) => v.videoId === storedVideoId)) {
      return { ...record, replayOfMasterId: row.id }
    }
  }
  return null
}

function creditedOn(record, discogsId) {
  const id = Number(discogsId)
  if (record.artists.length && record.artists.every((a) => a.id === id)) return 'whole'
  if (record.artists.some((a) => a.id === id)) return 'shared'
  if (record.tracklist.some((t) => t.artists.includes(id))) return 'track'
  if (record.extraartists.some((a) => a.id === id) || record.tracklist.some((t) => t.extraartists.some((a) => a.id === id))) return 'featured'
  return null
}

const youtubeCache = existsSync(YT_CACHE_PATH) ? JSON.parse(readFileSync(YT_CACHE_PATH, 'utf8')) : {}
let pending = []
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

function smokeSample(universe, size) {
  const quarantined = universe.filter(([, e]) => e.identityUnverified)
  const kept = universe.filter(([, e]) => !e.identityUnverified)
  const spread = (rows, n) => {
    const step = Math.max(1, Math.floor(rows.length / n))
    return Array.from({ length: Math.min(n, rows.length) }, (_, i) => rows[i * step])
  }
  const q = Math.round((size * quarantined.length) / universe.length)
  return [...spread(quarantined, q), ...spread(kept, size - q)]
}

async function main() {
  const token = env('DISCOGS_TOKEN')
  const ytKey = env('YOUTUBE_API_KEY')
  if (!token || !ytKey) throw new Error('DISCOGS_TOKEN and YOUTUBE_API_KEY required (.env.local)')
  mkdirSync(EVIDENCE_DIR, { recursive: true })

  const artists = loadArtistsByKey()
  const entries = loadPlayEntries()
  let universe = Object.entries(entries).filter(([, e]) => e.play?.kind === 'youtube-video')
  const idless = universe.filter(([k, e]) => !discogsIdOf(artists.get(k)?.artist, e))
  universe = universe.filter(([k, e]) => discogsIdOf(artists.get(k)?.artist, e))
  if (ONLY) universe = universe.filter(([k]) => k === ONLY)
  else if (SMOKE) universe = smokeSample(universe, SMOKE)
  log(`gather start: ${universe.length} link artists in scope (${idless.length} without a Discogs id skipped) · MB snapshot ${dumpSnapshot()?.snapshot ?? 'n/a'}`)

  const crosswalk = loadCrosswalk(universe.map(([k, e]) => discogsIdOf(artists.get(k)?.artist, e)))
  log(`crosswalk: ${crosswalk.size} Discogs ids linked by MusicBrainz`)

  const deadline = Date.now() + MINUTES * 60000
  let done = 0
  for (const [key, entry] of universe) {
    if (done >= LIMIT || Date.now() > deadline) break
    const path = evidencePath(key)
    if (existsSync(path) && isComplete(path)) continue
    fetchFailures = 0
    const held = artists.get(key)
    const discogsId = discogsIdOf(held?.artist, entry)
    const profile = await discogs(`/artists/${discogsId}`, token)
    const { listedCount, records, masterRows } = await gatherRecords(discogsId, token)
    const storedVideoId = videoIdOf(entry.play.url)
    if (!records.some((r) => r.videos.some((v) => v.videoId === storedVideoId))) {
      const collision = await replayMasterCollision(masterRows, storedVideoId, token)
      if (collision) records.push(collision)
    }
    const candidates = new Set([storedVideoId])
    for (const record of records) {
      if (record.replayOfMasterId || !creditedOn(record, discogsId)) continue
      for (const video of record.videos) if (candidates.size < CANDIDATE_CAP) candidates.add(video.videoId)
    }
    for (const id of candidates) if (!youtubeCache[id]) pending.push(id)
    while (pending.length >= YT_BATCH) await flushYoutube(ytKey)
    const evidence = {
      key,
      name: held?.artist.name ?? entry.name ?? null,
      countries: held?.countries ?? [],
      bucket: entry.identityUnverified ? 'quarantined' : 'kept',
      discogsId,
      storedVideoId,
      storedTitle: entry.title ?? null,
      datasetAliases: held?.artist.aliases ?? [],
      profile: profile
        ? { name: profile.name, realname: profile.realname ?? null, namevariations: profile.namevariations ?? [], urls: profile.urls ?? [] }
        : null,
      musicbrainz: musicbrainzEvidence(crosswalk.get(String(discogsId))),
      listedCount,
      records,
      candidateVideoIds: [...candidates],
      gatheredAt: new Date().toISOString(),
      ...(fetchFailures > 0 ? { incomplete: true, fetchFailures } : {}),
    }
    writeFileSync(path, JSON.stringify(evidence, null, 1))
    done++
    const credited = records.filter((r) => creditedOn(r, discogsId)).length
    log(`${key} ${evidence.name} · ${records.length} records (${credited} credited) · ${candidates.size} candidates${evidence.musicbrainz?.mbid ? ' · MB' : ''}${fetchFailures ? ` · INCOMPLETE (${fetchFailures} fetch failures, will redo)` : ''}`)
  }
  while (pending.length) await flushYoutube(ytKey)
  log(`gather done: ${done} artists this run`)
}

main().catch((error) => {
  log(`FATAL: ${error.stack ?? error.message}`)
  process.exit(1)
})
