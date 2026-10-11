/**
 * VERIFIED PLAY LINKS FOR "ON THIS DAY" (owner, Oct 10 2026: "Make the
 * songs playable … only verified videos get a play button, and only
 * playable songs go in the playlist. Tell me what it costs in YouTube
 * quota.").
 *
 * Runs AFTER scripts/build-on-this-day.mjs and writes `v` (video id), `vt`
 * (its YouTube title) and `vs` (the song it is) onto the LISTED items of
 * each month shard.
 *
 * IDENTITY, from local dumps only (scripts/lib/onThisDayPlay.mjs): the
 * artist's Discogs id comes from MusicBrainz's own url relation
 * (data/mb-dump/artist-links — an id, never a name; gap-fill items carry
 * theirs); the Discogs record must be this release (same title, same
 * year — for gap-fill items, the very release); the artist must be its
 * whole credit or credited on the matched track; the video must match a
 * track or the record by title, or one track by length.
 *
 * PLAYABLE, from YouTube: up to three candidates per item are checked
 * with videos.list (snippet, status, contentDetails, topicDetails — ONE
 * quota unit per 50 videos). A video plays only if public, embeddable,
 * at least 90 s, and clear of every content gate the queues use
 * (lib/play/contentGates.ts: annotation markers, television topic,
 * talk/promo descriptions), and not on another artist's "- Topic"
 * channel. That is the ONLY quota spent: the site serves the result as
 * static data, so visitors cost nothing.
 *
 * Resumable: YouTube answers cache in data/on-this-day-play-cache.json
 * (gitignored); a quota stop saves and a rerun continues.
 *
 *   node --env-file=.env.local scripts/verify-on-this-day-play.mjs
 * Report: data/on-this-day-play-report.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isNonSongUpload, isSongLength, nonMusicVerdict } from '../lib/play/contentGates.ts'
import { videoReleaseRefsFor, videoReleaseShard, videoReleaseShardOf } from './lib/discogsDump.mjs'
import { aliasKeys, normalizeName } from './lib/extraPlayIdentity.mjs'
import { getJson } from './lib/fetchJson.mjs'
import { candidateVideos } from './lib/onThisDayPlay.mjs'

const SHARD_DIR = 'lib/explore/on-this-day'
const LINKS_DIR = 'data/mb-dump/artist-links'
const CACHE_PATH = 'data/on-this-day-play-cache.json'
const REPORT_PATH = 'data/on-this-day-play-report.json'
const CANDIDATES_PER_ITEM = 3
const YT_BATCH = 50

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'))

function listedItems(shards) {
  const items = []
  for (const shard of Object.values(shards)) {
    for (const day of Object.values(shard.days)) items.push(...day.items)
  }
  return items
}

/** MusicBrainz artist id → Discogs artist ids, from MB's own url relations. */
function discogsIdsFor(mbids) {
  const byArtist = new Map()
  for (const file of readdirSync(LINKS_DIR).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(LINKS_DIR, file), 'utf8').split('\n')) {
      if (!line) continue
      const row = JSON.parse(line)
      if (!mbids.has(row.a) || !row.dg?.length) continue
      byArtist.set(row.a, new Set(row.dg.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
    }
  }
  return byArtist
}

function loadCache() {
  return existsSync(CACHE_PATH) ? readJson(CACHE_PATH) : {}
}

async function checkVideos(ids, cache, key) {
  const todo = [...new Set(ids)].filter((id) => !cache[id])
  let units = 0
  for (let at = 0; at < todo.length; at += YT_BATCH) {
    const batch = todo.slice(at, at + YT_BATCH)
    let body
    try {
      body = await getJson(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails,topicDetails&id=${batch.join(',')}&key=${key}`,
        {},
        { tries: 3, backoffMs: 2000 },
      )
    } catch (error) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache))
      throw new Error(`videos.list stopped after ${units} units (${error.message}) — rerun to continue`)
    }
    units++
    for (const item of body.items ?? []) {
      cache[item.id] = {
        title: item.snippet?.title ?? '',
        channel: item.snippet?.channelTitle ?? '',
        description: (item.snippet?.description ?? '').split('\n')[0],
        duration: item.contentDetails?.duration ?? null,
        privacy: item.status?.privacyStatus ?? null,
        embeddable: item.status?.embeddable === true,
        topics: item.topicDetails?.topicCategories ?? [],
      }
    }
    for (const id of batch) cache[id] ??= { gone: true }
    if (units % 20 === 0) writeFileSync(CACHE_PATH, JSON.stringify(cache))
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache))
  return units
}

/** Why a candidate may not play, or null when it may. */
function refusal(candidate, facts, item, aliases) {
  if (!facts || facts.gone) return 'video-gone'
  if (facts.privacy !== 'public' || !facts.embeddable) return 'not-public-or-embeddable'
  if (!isSongLength(facts.duration)) return 'under-90s'
  if (isNonSongUpload(facts.title, candidate.matchedTitle, item.n)) return 'title-marker'
  const verdict = nonMusicVerdict({
    title: facts.title,
    workTitle: candidate.matchedTitle,
    artistName: item.n,
    topicUrls: facts.topics,
    description: facts.description,
  })
  if (verdict.reasons.length > 0) return verdict.reasons[0]
  // YouTube's own statement of whose recording it is.
  if (/ - Topic$/.test(facts.channel) && !aliases.has(normalizeName(facts.channel.replace(/ - Topic$/, '')))) {
    return 'topic-channel-names-another-artist'
  }
  return null
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY missing — run with --env-file=.env.local')
  const shards = Object.fromEntries(months.map((month) => [month, readJson(join(SHARD_DIR, `${month}.json`))]))
  const items = listedItems(shards)
  const mbIds = discogsIdsFor(new Set(items.filter((item) => item.a).map((item) => item.a)))
  const artistIdsOf = (item) => (item.ga ? new Set([Number(item.ga)]) : mbIds.get(item.a) ?? new Set())

  // Each artist's video-bearing records, looked up in SHARD order: the
  // reader keeps only a few artist shards in memory, so a random order
  // reloads the same shard thousands of times.
  const discogsArtists = [...new Set(items.flatMap((item) => (item.dg ? [] : [...artistIdsOf(item)])))]
    .sort((a, b) => (a % 256) - (b % 256) || a - b)
  const refsOf = new Map(
    discogsArtists.map((id) => [id, videoReleaseRefsFor(id).filter((ref) => ref.kind !== 'x').map((ref) => ref.releaseId)]),
  )
  // Which video-bearing Discogs records each item could rest on.
  const recordIdsByItem = new Map()
  const wanted = new Map()
  for (const item of items) {
    const ids = item.dg
      ? [item.dg]
      : [...artistIdsOf(item)].flatMap((id) => refsOf.get(id) ?? [])
    recordIdsByItem.set(item, ids)
    for (const id of ids) {
      const shard = videoReleaseShardOf(id)
      if (!wanted.has(shard)) wanted.set(shard, new Set())
      wanted.get(shard).add(id)
    }
  }
  const records = new Map()
  for (const [shard, ids] of wanted) {
    const map = videoReleaseShard(shard)
    for (const id of ids) if (map.has(id)) records.set(id, map.get(id))
  }
  console.log(`items ${items.length}, with a Discogs link ${items.filter((item) => artistIdsOf(item).size > 0).length}, records loaded ${records.size}`)

  const candidatesByItem = new Map()
  for (const item of items) {
    const artistIds = artistIdsOf(item)
    const itemRecords = (recordIdsByItem.get(item) ?? []).map((id) => records.get(id)).filter(Boolean)
    if (artistIds.size === 0 || itemRecords.length === 0) continue
    const creditNames = itemRecords.flatMap((record) =>
      record.artists.filter((credit) => artistIds.has(credit.id)).flatMap((credit) => [credit.name, credit.anv]))
    const aliases = aliasKeys({ name: item.n, aliases: creditNames.filter(Boolean) })
    const candidates = candidateVideos({ item, artistIds, records: itemRecords, aliases }).slice(0, CANDIDATES_PER_ITEM)
    if (candidates.length > 0) candidatesByItem.set(item, { candidates, aliases })
  }
  console.log(`items with an identity-verified candidate: ${candidatesByItem.size}`)

  const cache = loadCache()
  const before = Object.keys(cache).length
  const units = await checkVideos([...candidatesByItem.values()].flatMap(({ candidates }) => candidates.map((c) => c.videoId)), cache, key)

  const refusals = {}
  const playOf = new Map()
  for (const item of items) {
    const entry = candidatesByItem.get(item)
    if (!entry) continue
    for (const candidate of entry.candidates) {
      const why = refusal(candidate, cache[candidate.videoId], item, entry.aliases)
      if (why) {
        refusals[why] = (refusals[why] ?? 0) + 1
        continue
      }
      // `vs`: the song this video is (the matched track, or the release itself).
      playOf.set(item, { v: candidate.videoId, vt: cache[candidate.videoId].title, vs: candidate.matchedTitle })
      break
    }
  }
  const verified = playOf.size
  // New item objects: a stale link from an earlier run is dropped, a
  // verified one written.
  const withPlay = (item) => ({
    ...Object.fromEntries(Object.entries(item).filter(([field]) => !['v', 'vt', 'vs'].includes(field))),
    ...playOf.get(item),
  })
  for (const month of months) {
    const shard = shards[month]
    const days = Object.fromEntries(
      Object.entries(shard.days).map(([date, day]) => [date, { ...day, items: day.items.map(withPlay) }]),
    )
    writeFileSync(join(SHARD_DIR, `${month}.json`), JSON.stringify({ ...shard, days }))
  }

  const byDecade = {}
  for (const item of items) {
    const decade = String(Math.floor(item.y / 10) * 10)
    byDecade[decade] ??= { listed: 0, playable: 0 }
    byDecade[decade].listed++
    if (playOf.has(item)) byDecade[decade].playable++
  }
  const report = {
    builtAt: new Date().toISOString(),
    listedItems: items.length,
    withDiscogsLink: items.filter((item) => artistIdsOf(item).size > 0).length,
    withIdentityVerifiedCandidate: candidatesByItem.size,
    playable: verified,
    candidatesRefused: refusals,
    byDecade,
    youtube: {
      videosListCallsThisRun: units,
      quotaUnitsThisRun: units,
      videosCheckedThisRun: Object.keys(cache).length - before,
      note: 'videos.list costs 1 unit per call of up to 50 ids; nothing else here calls YouTube, and the site serves the result as static data.',
    },
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ playable: verified, of: items.length, quotaUnits: units, refusals }))
}

main().catch((error) => {
  console.error('Fatal:', error.message)
  process.exit(1)
})
