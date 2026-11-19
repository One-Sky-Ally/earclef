/**
 * BUILD — each pooled artist's Discogs-listed YouTube videos that name
 * one of their own works, for the queue to check BEFORE spending a
 * search (owner go, Nov 19 2026: "use Discogs video lists before
 * searching").
 *
 * Zero quota. Everything is read from the local dumps:
 *   MB artist → Discogs artist(s)   data/mb-dump/artist-links (url-rels)
 *   their video-bearing records     discogs index videos-by-artist
 *                                   (main 'm' and track 't' credits only;
 *                                   'x' credits are engineers, designers…)
 *   the videos and tracklists       discogs index video-releases
 *   the artist's own work titles    MB release groups (rg-by-artist), MB
 *                                   tracklists (rg-tracklists), and the
 *                                   Discogs titles credited to them on
 *                                   that record
 *
 * A video is kept when its Discogs title names one of those works
 * (lib/play/artistMatch findWork: word boundaries, longest wins). At
 * request time the queue still checks it with videos.list (1 unit per 50,
 * the 10,000 bucket): the uploader must be named for the artist, the
 * CURRENT title must still name the work, and the playability and music
 * gates apply. This file only says where to look.
 *
 * Output: lib/play/discogs-videos/{index.json, 00..ff.json}, keyed by the
 * first two hex characters of the MBID, like rg-dating. Each row is
 * [videoId, workTitle, year | null, source], where source 'm' means the
 * work title is in the MB catalogue and 'd' means only Discogs credits it.
 *
 *   node --max-old-space-size=12288 --import ./scripts/test/resolve-ts.mjs \
 *     scripts/build-discogs-videos.mjs
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { identifies, isNameOnly, matchKey, names as videoNamesWork } from '../lib/play/artistMatch.ts'
import { loadPlaces, walkPools } from './lib/placePools.mjs'

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'lib/play/discogs-videos')
const DISCOGS_INDEX = join(ROOT, 'data/discogs-dump/index')
/** Per artist: enough for one videos.list call (≤50 ids) with room for gates. */
const PER_ARTIST = 30
/** Uploads of one work kept: a second copy survives a dead or gated first. */
const PER_WORK = 2

const log = (line) => process.stdout.write(`${line}\n`)
const readGzJsonl = (path) =>
  gunzipSync(readFileSync(path)).toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const shardOf = (numeric) => (numeric % 256).toString(16).padStart(2, '0')
const yearOf = (value) => Number(String(value ?? '').slice(0, 4)) || null
const YOUTUBE_ID = /[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/

function pooledArtists() {
  const names = new Map()
  walkPools(loadPlaces(ROOT), (_code, _year, pool) => {
    for (const artist of pool) names.set(artist.id, artist.name)
  })
  return names
}

function discogsLinks(names) {
  const links = new Map()
  const dir = join(ROOT, 'data/mb-dump/artist-links')
  for (const file of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.startsWith('{"a":"') || !names.has(line.slice(6, 42))) continue
      const row = JSON.parse(line)
      const ids = (row.dg ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)
      if (ids.length > 0) links.set(row.a, ids)
    }
  }
  return links
}

/** MB works per artist: release-group titles + their tracklists, with years. */
function mbWorks(artists) {
  const works = new Map()
  const groupsOf = new Map()
  const rgDir = join(ROOT, 'data/mb-dump/rg-by-artist')
  for (const file of readdirSync(rgDir)) {
    for (const line of readFileSync(join(rgDir, file), 'utf8').split('\n')) {
      if (!line.startsWith('{"a":"') || !artists.has(line.slice(6, 42))) continue
      const row = JSON.parse(line)
      const list = works.get(row.a) ?? []
      list.push({ title: row.t, year: yearOf(row.d), source: 'm' })
      works.set(row.a, list)
      groupsOf.set(row.i, { artist: row.a, year: yearOf(row.d) })
    }
  }
  const tlDir = join(ROOT, 'data/mb-dump/rg-tracklists')
  for (const file of readdirSync(tlDir)) {
    for (const line of readFileSync(join(tlDir, file), 'utf8').split('\n')) {
      if (!line) continue
      const row = JSON.parse(line)
      const group = groupsOf.get(row.g)
      if (!group) continue
      const list = works.get(group.artist)
      for (const title of row.t ?? []) list.push({ title, year: group.year, source: 'm' })
    }
  }
  return works
}

/** Discogs artist id → [{ releaseId, kind }] for 'm' and 't' credits. */
function videoRefs(discogsIds) {
  const refs = new Map()
  const dir = join(DISCOGS_INDEX, 'videos-by-artist')
  for (const file of readdirSync(dir)) {
    for (const row of readGzJsonl(join(dir, file))) {
      if (row.k === 'x' || !discogsIds.has(row.a)) continue
      const list = refs.get(row.a) ?? []
      list.push({ releaseId: row.r, kind: row.k ?? 'm' })
      refs.set(row.a, list)
    }
  }
  return refs
}

/** Titles Discogs credits to this artist on one record. */
function creditedTitles(row, discogsId, kind) {
  const tracks = (row.tl ?? []).filter(([, , , artists]) =>
    kind === 'm' ? !artists?.length || artists.includes(discogsId) : (artists ?? []).includes(discogsId),
  )
  const titles = tracks.map(([, title]) => title)
  return kind === 'm' ? [row.t, ...titles] : titles
}

/** Scripts written without spaces (artistMatch's containment set). */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u
/** MB works considered per artist: plenty for matching, bounded for speed. */
const WORKS_CAP = 2000

/**
 * Keyed once: { key, title, year, source, first } — first token for a
 * cheap prefilter. Works that are only the artist's name (self-titled
 * records, name fragments) are left out: every video naming the artist
 * would "match" them.
 */
function prepare(list, artistName, cap = Infinity) {
  const seen = new Map()
  // De-duplicate EVERYTHING first (keeping each title's earliest year), and
  // only then cap — capping first lost titles' earliest years (code review,
  // Nov 19 2026). Release-group titles come first in the list, so the cap
  // keeps them.
  for (const work of list) {
    const key = matchKey(work.title)
    if (!key || !identifies(key) || isNameOnly(work.title, artistName)) continue
    const held = seen.get(key)
    if (held) {
      // MB's own titles outrank Discogs-only ones; then the earliest year.
      const better =
        (work.source === 'm' && held.source === 'd') ||
        (work.source === held.source && (work.year ?? 9999) < (held.year ?? 9999))
      if (!better) continue
    }
    seen.set(key, { key, title: work.title, year: work.year ?? null, source: work.source, unspaced: UNSPACED.test(key), first: key.split(' ')[0] })
  }
  return [...seen.values()].slice(0, cap)
}

/** artistMatch.findWork's rule over prepared works: longest key that the video names. */
function bestWork(videoKey, tokens, prepared) {
  let best = null
  for (const work of prepared) {
    if (best && work.key.length <= best.key.length) continue
    if (work.unspaced ? !videoKey.includes(work.key) : !tokens.has(work.first) || !videoNamesWork(videoKey, work.key)) continue
    best = work
  }
  return best
}

function main() {
  const names = pooledArtists()
  log(`pooled artists ${names.size}`)
  const links = discogsLinks(names)
  log(`with a Discogs link ${links.size}`)
  const works = mbWorks(new Set(links.keys()))
  log(`with MB works ${works.size}`)
  const byDiscogs = new Map()
  for (const [mbid, ids] of links) {
    for (const id of ids) byDiscogs.set(id, [...(byDiscogs.get(id) ?? []), mbid])
  }
  const refs = videoRefs(new Set(byDiscogs.keys()))
  log(`Discogs artists with video records ${refs.size}`)

  const wantedByShard = new Map()
  for (const list of refs.values()) {
    for (const { releaseId } of list) {
      const shard = shardOf(releaseId)
      wantedByShard.set(shard, (wantedByShard.get(shard) ?? new Set()).add(releaseId))
    }
  }
  const releaseRows = new Map()
  let loaded = 0
  for (const [shard, wanted] of wantedByShard) {
    for (const row of readGzJsonl(join(DISCOGS_INDEX, 'video-releases', `${shard}.jsonl.gz`))) {
      if (wanted.has(row.i)) releaseRows.set(row.i, { t: row.t, y: row.y ?? null, tl: row.tl ?? [], vs: row.vs ?? [] })
    }
    loaded += 1
    if (loaded % 32 === 0) log(`  release shards ${loaded}/${wantedByShard.size}`)
  }

  const out = new Map()
  let artistsWithRows = 0
  let rows = 0
  let done = 0
  for (const [mbid, ids] of links) {
    done += 1
    if (done % 5000 === 0) log(`  artists ${done}/${links.size}`)
    const artistName = names.get(mbid) ?? ''
    const own = prepare(works.get(mbid) ?? [], artistName, WORKS_CAP)
    const videos = new Map()
    for (const id of ids) {
      for (const { releaseId, kind } of refs.get(id) ?? []) {
        const row = releaseRows.get(releaseId)
        if (!row) continue
        const credited = prepare(creditedTitles(row, id, kind).map((title) => ({ title, year: row.y, source: 'd' })), artistName)
        for (const [url, videoTitle] of row.vs) {
          const match = url.match(YOUTUBE_ID)
          const videoId = match?.[1] ?? match?.[2]
          if (!videoId) continue
          const held = videos.get(videoId)
          if (held) {
            // A Discogs-only title takes the earliest year of every record
            // that lists the video.
            if (held.source === 'd' && row.y && (!held.year || row.y < held.year)) held.year = row.y
            continue
          }
          const videoKey = matchKey(videoTitle ?? '')
          if (!videoKey) continue
          const tokens = new Set(videoKey.split(' '))
          const fromMb = bestWork(videoKey, tokens, own)
          const fromDiscogs = bestWork(videoKey, tokens, credited)
          const work = fromMb && (!fromDiscogs || fromMb.key.length >= fromDiscogs.key.length) ? fromMb : fromDiscogs
          if (!work) continue
          videos.set(videoId, { videoId, work: work.title, workKey: work.key, year: work.year, source: work.source, main: kind === 'm' })
        }
      }
    }
    if (videos.size === 0) continue
    const perWork = new Map()
    const ranked = [...videos.values()]
      .sort((a, b) => (a.source === b.source ? 0 : a.source === 'm' ? -1 : 1) || Number(b.main) - Number(a.main))
      .filter((entry) => {
        const count = perWork.get(entry.workKey) ?? 0
        perWork.set(entry.workKey, count + 1)
        return count < PER_WORK
      })
      .slice(0, PER_ARTIST)
      .map((entry) => [entry.videoId, entry.work, entry.year, entry.source])
    const shard = mbid.slice(0, 2)
    if (!out.has(shard)) out.set(shard, {})
    out.get(shard)[mbid] = ranked
    artistsWithRows += 1
    rows += ranked.length
  }

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [shard, entries] of out) writeFileSync(join(OUT_DIR, `${shard}.json`), JSON.stringify(entries))
  const index = {
    version: `discogs-20260901+mb-20260829+${new Date().toISOString().slice(0, 10)}`,
    builtAt: new Date().toISOString(),
    artists: artistsWithRows,
    videos: rows,
    shards: [...out.keys()].sort(),
  }
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 1))
  log(JSON.stringify({ ...index, shards: index.shards.length }, null, 1))
}

main()
