/**
 * "SONGS ABOUT THIS PLACE" — STAGE 2 (owner go, Oct 12 2026): verify
 * a playable video for every gathered song, and write the served file.
 *
 * IDENTITY, per song, for every performer Wikidata names with a
 * MusicBrainz id — by WHOLE TITLES ONLY (owner go, Nov 26 2026, after
 * the Nov 25 measurement: 7 of 1,195 served videos played another song,
 * every one through a looser leg):
 *   · Discogs release videos from the LOCAL dump, under the On-this-day
 *     bar (lib/play/songIdentity: the performer's Discogs id — from
 *     MusicBrainz's own url relation — is the record's whole credit or
 *     is on the matched track; the video's title equals a track's) AND
 *     that track's title equals THIS song's title (whole units). Never by
 *     LENGTH: Counting Crows' "Miami" played a Shrek 2 DVD extra and
 *     Duffy's "Warwick Avenue" played "Fool For You";
 *   · the performer's MB-linked YouTube channel: an upload that names
 *     the song's title as a whole unit (lib/play/titleVariants). Never by
 *     CONTAINMENT: "la" inside "Flags" made Neil Young's "L.A." play
 *     "Flags of Freedom", "London" made Pet Shop Boys' play "New London
 *     Boy";
 *   · HAND-CHECKED videos (data/songs-about-hand-checked.json): a video
 *     a person watched or checked by its YouTube page and found to be
 *     this song by this performer, where the title alone cannot say so
 *     ("Picadilly Circus", "Nebraska Lyrics"). The file's "wrong" list is
 *     never served, whatever matches it.
 * PLAYABLE: one batched videos.list per 50 ids (cached in
 * data/songs-about-play-cache.json only to resume after a quota stop:
 * a complete run DELETES it — pass --keep-cache to rerun the same day —
 * and a cache older than 29 days is never read; YouTube API data is
 * never kept past 30 days), public +
 * embeddable + ≥90 s, the queue's content gates, whole-record uploads
 * and livestream recordings out. The bar is On this
 * day's (owner ruling): a Discogs-attached, title-matched video is
 * verified whoever uploaded it. The plain record outranks any version;
 * a version that plays is labelled.
 *
 * Only songs with a verified video reach lib/explore/songs-about-
 * places.json (owner: never list music people cannot listen to). A
 * quota stop saves the cache and exits; rerun to continue.
 *
 *   node --import ./scripts/test/resolve-ts.mjs --env-file=.env.local scripts/verify-songs-about-play.mjs
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { videoIndexAvailable, videoReleaseRefsFor, videoReleaseShard, videoReleaseShardOf } from './lib/discogsDump.mjs'
import { rankCandidates, servedUnder, versionOf } from './lib/songsAboutPlaces.mjs'
import { recordSongCandidates } from '../lib/play/songIdentity.ts'
import { aliasKeysOf, normalizeName, titleVariants, variantsIntersect, wholeTitleKeys } from '../lib/play/titleVariants.ts'
import { isWholeRecordUpload, uploadKindOf } from '../lib/play/officialVideo.ts'
import { channelId, channelUploads, playableSet, QuotaError } from '../lib/play/channelSongs.ts'
import { annotationOf, isNonSongUpload, nonMusicVerdict } from '../lib/play/contentGates.ts'
import { isBroadcast } from '../lib/discover/song.ts'

const ROOT = process.cwd()
const WORK = join(ROOT, 'data', 'songs-about-work.json')
const CACHE = join(ROOT, 'data', 'songs-about-play-cache.json')
const OUT = join(ROOT, 'lib', 'explore', 'songs-about-places.json')
const REPORT = join(ROOT, 'data', 'songs-about-play-report.json')
const HAND_CHECKED = join(ROOT, 'data', 'songs-about-hand-checked.json')
const LINKS_DIR = join(ROOT, 'data', 'mb-dump', 'artist-links')
const KEY = process.env.YOUTUBE_API_KEY
if (!KEY) throw new Error('YOUTUBE_API_KEY missing')
if (!videoIndexAvailable()) throw new Error('Discogs video index missing (data/discogs-dump/index)')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const work = readJson(WORK)
/** YouTube API data is kept 29 days at most (privacy page; Developer Policies III.E.4). */
const CACHE_DAYS = 29
const freshCache = () => ({ fetchedAt: new Date().toISOString(), channels: {}, videos: {} })
const cachedAt = (held) => Date.parse(held?.fetchedAt ?? '') || 0
const held = existsSync(CACHE) ? readJson(CACHE) : null
const cache = held && Date.now() - cachedAt(held) < CACHE_DAYS * 86_400_000 ? held : freshCache()
if (held && cache !== held) console.log(`play cache from ${held.fetchedAt ?? 'before Nov 26 2026'} is past ${CACHE_DAYS} days: fetching again`)
const saveCache = () => writeFileSync(CACHE, JSON.stringify(cache))
const handChecked = existsSync(HAND_CHECKED) ? readJson(HAND_CHECKED) : {}
const handRight = handChecked.right ?? []
const checkedKey = (page, videoId) => `${page}\u0000${videoId}`
const knownWrong = new Set((handChecked.wrong ?? []).map((entry) => checkedKey(entry.wp, entry.v)))
const KEEP_CACHE = process.argv.includes('--keep-cache')
let units = 0

/** MusicBrainz artist id → { n, dg[], yt[] } from the local link index. */
const links = new Map()
for (const file of readdirSync(LINKS_DIR).filter((name) => name.endsWith('.jsonl'))) {
  for (const line of readFileSync(join(LINKS_DIR, file), 'utf8').split('\n')) {
    if (line) { const row = JSON.parse(line); links.set(row.a, row) }
  }
}

async function retry(fn, tries = 3) {
  let last
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fn() } catch (error) { if (error instanceof QuotaError) throw error; last = error; await sleep(2000 * attempt) }
  }
  throw last
}

/** Uploads of an MB-linked channel, cached per channel URL (≤5 units once). */
async function uploadsFor(channelUrl) {
  if (cache.channels[channelUrl]) return cache.channels[channelUrl]
  let uploads = []
  try {
    const id = await retry(() => channelId(channelUrl, KEY))
    units += /\/channel\//.test(channelUrl) ? 0 : 1
    uploads = id ? await retry(() => channelUploads(id, KEY)) : []
    units += Math.max(1, Math.ceil(uploads.length / 50))
  } catch (error) {
    // A deleted or renamed channel 404s: that performer simply has no
    // channel path. Quota trouble is the one error that must stop the run.
    if (error instanceof QuotaError) throw error
  }
  cache.channels[channelUrl] = uploads
  return uploads
}

/**
 * Phase 0: the Discogs records every performer needs, loading each of
 * the 256 video-release shards ONCE (the per-artist reader reloads
 * shards per call — with 1,300 performers that ran for 14 hours on
 * Oct 12 without finishing). A record is kept only when a video,
 * track or record title CONTAINS one of the performer's song keys —
 * a pre-filter that can only exclude; the identity bar still runs in
 * full on what remains.
 */
const slim = (record) => ({
  id: record.id, title: record.title, year: record.year,
  artists: record.artists.map((credit) => Number(credit.id)),
  tracklist: record.tracklist.map((track) => ({ title: track.title, duration: track.duration, artists: (track.artists ?? []).map((credit) => Number(credit?.id ?? credit)).filter(Boolean) })),
  videos: record.videos, labels: [],
})

function loadDiscogsRecords(wantedByDg) {
  const byShard = new Map()
  const dgIds = [...wantedByDg.keys()].sort((a, b) => (a % 256) - (b % 256))
  for (const dgId of dgIds) {
    for (const ref of videoReleaseRefsFor(dgId)) {
      const shard = videoReleaseShardOf(ref.releaseId)
      const releases = byShard.get(shard) ?? byShard.set(shard, new Map()).get(shard)
      ;(releases.get(ref.releaseId) ?? releases.set(ref.releaseId, new Set()).get(ref.releaseId)).add(dgId)
    }
  }
  const recordsByDg = new Map()
  let shardsDone = 0
  for (const [shard, releases] of byShard) {
    const map = videoReleaseShard(shard)
    for (const [releaseId, owners] of releases) {
      const record = map.get(releaseId)
      if (!record) continue
      const haystack = [record.title, ...record.tracklist.map((track) => track.title), ...record.videos.map((video) => video.title)].map(normalizeName).join(' ')
      for (const dgId of owners) {
        const keys = wantedByDg.get(dgId)
        if (![...keys].some((key) => key && haystack.includes(key))) continue
        ;(recordsByDg.get(dgId) ?? recordsByDg.set(dgId, []).get(dgId)).push(slim(record))
      }
    }
    if (++shardsDone % 32 === 0) console.log(`discogs shards ${shardsDone}/${byShard.size}`)
  }
  return recordsByDg
}

let recordsByDg = new Map()

/** Phase A: every candidate video for a song, from every MB performer. */
async function gather(song) {
  const found = new Map()
  for (const named of song.performers.filter((entry) => entry.mbid)) {
    const link = links.get(named.mbid)
    // A Wikidata item without an English label still has its MusicBrainz
    // name in the link index; an entry is never served nameless.
    const performer = { ...named, name: named.name ?? link?.n ?? null }
    if (!performer.name) continue
    const aliases = aliasKeysOf([performer.name, link?.n])
    const wanted = titleVariants(song.title, aliases)
    if (wanted.size === 0) continue
    const dgIds = (link?.dg ?? []).map(Number).filter((id) => id > 0)
    const records = dgIds.flatMap((id) => recordsByDg.get(id) ?? [])
    if (records.length) {
      for (const candidate of recordSongCandidates(records, new Set(dgIds), aliases, { byLength: false })) {
        if (!variantsIntersect(titleVariants(candidate.songTitle, aliases), wanted)) continue
        if (!found.has(candidate.videoId)) found.set(candidate.videoId, { videoId: candidate.videoId, uploadTitle: candidate.uploadTitle, source: 'discogs', performer, aliases })
      }
    }
    const channelUrl = link?.yt?.[0]
    const whole = wholeTitleKeys(song.title, aliases)
    if (channelUrl && whole.size > 0) {
      for (const upload of await uploadsFor(channelUrl)) {
        if (!variantsIntersect(titleVariants(upload.title, aliases), whole)) continue
        if (isNonSongUpload(upload.title, song.title, performer.name ?? '')) continue
        found.set(upload.videoId, { videoId: upload.videoId, uploadTitle: upload.title, source: 'channel', performer, aliases })
      }
    }
  }
  const allowed = (candidate) => !knownWrong.has(checkedKey(song.page, candidate.videoId))
  // A hand-checked video is a fallback: it keeps a place under the 50-candidate
  // cap, but ranks after every video the title itself vouches for.
  const hand = handPicked(song).filter((candidate) => allowed(candidate) && !found.has(candidate.videoId))
  return [...[...found.values()].filter(allowed).slice(0, 50 - hand.length), ...hand]
}

/** A song's hand-checked videos; each title comes from YouTube's own answer at playability time. */
function handPicked(song) {
  return handRight
    .filter((entry) => entry.wp === song.page)
    .flatMap((entry) => {
      const named = song.performers.find((performer) => performer.mbid === entry.mbid)
      const link = links.get(entry.mbid)
      const name = named?.name ?? link?.n ?? null
      if (!named || !name) return []
      return [{ videoId: entry.v, uploadTitle: null, source: 'hand-checked', performer: { ...named, name }, aliases: aliasKeysOf([name, link?.n]) }]
    })
}

/** Phase B: playability facts for every unique id, 50 per unit, cached. */
async function checkVideos(ids) {
  const todo = [...new Set(ids)].filter((id) => !cache.videos[id])
  for (let at = 0; at < todo.length; at += 50) {
    const batch = todo.slice(at, at + 50)
    const { playable, meta } = await retry(() => playableSet(batch, KEY))
    units += 1
    for (const id of batch) {
      const facts = meta.get(id)
      cache.videos[id] = { ok: playable.has(id), ch: facts?.channelTitle ?? '', t: facts?.title ?? '', s: facts?.seconds ?? 0, st: Boolean(facts?.streamed), d: facts?.description?.split('\n')[0] ?? '', tp: facts?.topicUrls ?? [] }
    }
    saveCache()
  }
}

/** Phase C: the song's best playable video, or null. */
function choose(song, candidates) {
  const passing = candidates.flatMap((found) => {
    const facts = cache.videos[found.videoId]
    const name = found.performer.name ?? ''
    if (!facts?.ok) return []
    // A livestream's recording is never a song (Mediæval Bæbes, Nov 24 2026).
    if (isBroadcast({ streamed: facts.st, seconds: facts.s })) return []
    const candidate = found.uploadTitle === null ? { ...found, uploadTitle: facts.t ?? '' } : found
    if (!candidate.uploadTitle) return []
    if (isWholeRecordUpload(candidate.uploadTitle, song.title, name)) return []
    if (nonMusicVerdict({ title: candidate.uploadTitle, workTitle: song.title, artistName: name, topicUrls: facts.tp, description: facts.d }).reasons.length) return []
    // On this day's bar (owner ruling, Oct 12 2026): a video Discogs ties
    // to the performer's own record, whose title equals the song, is
    // verified whoever uploaded it — no trusted-uploader rule here.
    const kind = uploadKindOf(candidate.uploadTitle, song.title, name, facts.ch)
    // The version is read from the title YouTube shows today when there is
    // one: a Discogs video title can predate "(short ver.)" or "(… RMX)".
    // Only when it still names the song: otherwise its own words would be read as the note.
    const shownTitle = facts.t && normalizeName(facts.t).includes(normalizeName(song.title)) ? facts.t : candidate.uploadTitle
    return [{ ...candidate, kind, uploader: facts.ch, version: versionOf(annotationOf(shownTitle, song.title, name)) }]
  })
  return rankCandidates(passing)[0] ?? null
}

async function main() {
  const songs = Object.values(work.songs).filter((song) => song.performers.some((performer) => performer.mbid))
  console.log(`songs with an MB performer: ${songs.length} of ${Object.keys(work.songs).length}`)
  const wantedByDg = new Map()
  for (const song of songs) {
    for (const performer of song.performers.filter((entry) => entry.mbid)) {
      for (const dgId of (links.get(performer.mbid)?.dg ?? []).map(Number).filter((id) => id > 0)) {
        ;(wantedByDg.get(dgId) ?? wantedByDg.set(dgId, new Set()).get(dgId)).add(normalizeName(song.title))
      }
    }
  }
  console.log(`loading Discogs records for ${wantedByDg.size} performers…`)
  recordsByDg = loadDiscogsRecords(wantedByDg)
  console.log(`records kept ${[...recordsByDg.values()].reduce((n, list) => n + list.length, 0)} for ${recordsByDg.size} performers`)
  const gathered = new Map()
  try {
    let n = 0
    for (const song of songs) {
      gathered.set(song.page, await gather(song))
      if (++n % 100 === 0) { saveCache(); console.log(`gathered ${n}/${songs.length} (${units} units)`) }
    }
    saveCache()
    await checkVideos([...gathered.values()].flat().map((candidate) => candidate.videoId))
  } catch (error) {
    saveCache()
    if (error instanceof QuotaError) { console.error(`YouTube quota exhausted after ${units} units — cache saved, rerun tomorrow to continue`); process.exit(2) }
    throw error
  }

  const places = {}
  const report = { generatedAt: new Date().toISOString(), units, songs: songs.length, playable: 0, byKind: {}, versions: 0, misses: [] }
  for (const song of songs) {
    const best = choose(song, gathered.get(song.page) ?? [])
    if (!best) { report.misses.push({ page: song.page, title: song.title, performers: song.performers.map((p) => p.name), candidates: (gathered.get(song.page) ?? []).length }); continue }
    report.playable++
    report.byKind[best.kind] = (report.byKind[best.kind] ?? 0) + 1
    if (best.version) report.versions++
    const entry = { t: song.title, a: best.performer.name ?? '', mbid: best.performer.mbid, v: best.videoId, k: best.kind, wp: song.page, ...(song.year ? { y: song.year } : {}), ...(best.version ? { ver: best.version } : {}) }
    for (const place of song.places) {
      for (const key of servedUnder(place)) {
        places[key] ??= { name: null, kind: null, songs: [] }
        if (key === place.key) { places[key].name = place.name; places[key].kind = place.kind }
        if (places[key].songs.some((held) => held.v === entry.v)) continue
        places[key].songs.push(key === place.key ? entry : { ...entry, about: place.name })
      }
    }
  }
  // A country reached only through its cities still needs a name.
  const countryNames = {}
  for (const song of Object.values(work.songs)) for (const place of song.places) if (place.kind === 'country') countryNames[place.key] = place.name
  const intl = new Intl.DisplayNames(['en'], { type: 'region' })
  for (const [key, place] of Object.entries(places)) {
    if (!place.name) { place.kind = 'country'; try { place.name = countryNames[key] ?? intl.of(key) } catch { place.name = key } }
    // Songs about the place itself first, then its cities/states, each by year.
    const byYear = (a, b) => (a.y ?? 9999) - (b.y ?? 9999) || a.t.localeCompare(b.t)
    place.songs = [...place.songs.filter((song) => !song.about).sort(byYear), ...place.songs.filter((song) => song.about).sort(byYear)]
  }
  const served = Object.fromEntries(Object.entries(places).filter(([key]) => !key.includes('|')))
  writeFileSync(OUT, JSON.stringify({ generatedAt: report.generatedAt, source: 'en.wikipedia "Songs about <place>" categories; videos verified under the site\'s play bar', places: served }, null, 1) + '\n')
  writeFileSync(REPORT, JSON.stringify(report, null, 1))
  if (!KEEP_CACHE && existsSync(CACHE)) rmSync(CACHE)
  console.log(`playable ${report.playable}/${songs.length} (${JSON.stringify(report.byKind)}, versions ${report.versions}); places served ${Object.keys(served).length}; units ${units}`)
}

main().catch((error) => { console.error(error); process.exit(1) })
