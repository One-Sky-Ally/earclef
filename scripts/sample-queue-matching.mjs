/**
 * HAND-CHECK SAMPLE — the Nov 19 2026 matching under the owner's
 * principle: "It must be the right artist's music … check a sample by
 * hand and tell me what you found."
 *
 * Runs the real resolver (lib/play/queue/resolveArtist.ts) locally, with
 * no Blobs, for a seeded random sample of pooled artist × decades:
 * RANDOM pairs from all pools, plus NONLATIN pairs from artists with
 * non-Latin-script names, so alias and both-scripts channel matches turn
 * up. Searches are OFF unless --search N, which lets the first N artists
 * that only a search could answer spend one each (counted against the
 * project's 100 a day).
 *
 * Every found track is written with HOW it was matched (track.how) and its
 * uploader's current channel name (one extra videos.list per 50). Output:
 * data/queue-matching-sample.json, for the hand check reported to the owner.
 *
 *   node --env-file=.env.local --no-warnings --max-old-space-size=8192 \
 *     --import ./scripts/test/resolve-ts.mjs scripts/sample-queue-matching.mjs [--search 10]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPlaces, walkPools } from './lib/placePools.mjs'
import { matchKey } from '../lib/play/artistMatch.ts'
import { playableSetAll } from '../lib/play/channelSongs.ts'
import { resolveArtist } from '../lib/play/queue/resolveArtist.ts'
import { rgDatingFor } from '../lib/explore/rgDating.ts'

const ROOT = process.cwd()
const OUT = join(ROOT, 'data/queue-matching-sample.json')
const SEED = 20261119
const RANDOM = 90
const NONLATIN = 40
const flag = process.argv.indexOf('--search')
const SEARCH_BUDGET = flag === -1 ? 0 : Number(process.argv[flag + 1] ?? 0)

const log = (line) => process.stdout.write(`${line}\n`)
const LATIN = /\p{Script=Latin}/u
const hasNoLatin = (value) => {
  const letters = value.match(/\p{L}/gu) ?? []
  return letters.length > 0 && !letters.some((ch) => LATIN.test(ch))
}

function mulberry32(seed) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function samplePairs() {
  const pairs = new Map()
  walkPools(loadPlaces(ROOT), (code, year, pool) => {
    const decade = Math.floor(year / 10) * 10
    for (const artist of pool) {
      const key = `${artist.id}|${decade}`
      if (!pairs.has(key)) pairs.set(key, { mbid: artist.id, name: artist.name, decade, place: code })
    }
  })
  const random = mulberry32(SEED)
  const shuffled = [...pairs.values()].map((pair) => ({ pair, r: random() })).sort((a, b) => a.r - b.r).map(({ pair }) => pair)
  const seen = new Set()
  const take = (list, count) =>
    list.filter((pair) => !seen.has(pair.mbid)).slice(0, count).map((pair) => (seen.add(pair.mbid), pair))
  return [
    ...take(shuffled, RANDOM).map((pair) => ({ ...pair, stratum: 'random' })),
    ...take(shuffled.filter((pair) => hasNoLatin(pair.name)), NONLATIN).map((pair) => ({ ...pair, stratum: 'non-latin' })),
  ]
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY missing — run with --env-file=.env.local')
  const pairs = samplePairs()
  log(`sample: ${pairs.length} artist × decades (search budget ${SEARCH_BUDGET})`)
  let searchesLeft = SEARCH_BUDGET
  const rows = []
  for (const [index, pair] of pairs.entries()) {
    const dating = await rgDatingFor(pair.mbid)
    const base = { mbid: pair.mbid, decade: pair.decade, name: pair.name, apiKey, dating, titleKey: matchKey, searchKind: 's' }
    try {
      let result = await resolveArtist({ ...base, allowSearch: false })
      let searched = false
      if (result.needsSearch && searchesLeft > 0) {
        searchesLeft -= 1
        searched = true
        result = await resolveArtist({ ...base, allowSearch: true })
      }
      rows.push({ ...pair, needsSearch: result.needsSearch, searched, tracks: result.tracks })
      log(`${index + 1}/${pairs.length} ${pair.name} ${pair.decade}: ${result.tracks.length} tracks${result.needsSearch ? ' (needs search)' : ''}${searched ? ' [searched]' : ''}`)
    } catch (error) {
      rows.push({ ...pair, error: String(error?.message ?? error) })
      log(`${index + 1}/${pairs.length} ${pair.name}: ERROR ${error?.message ?? error}`)
      if (String(error?.constructor?.name) === 'QuotaError') break
    }
  }
  const ids = rows.flatMap((row) => (row.tracks ?? []).map((track) => track.videoId))
  const { meta } = await playableSetAll(ids, apiKey)
  const withUploader = rows.map((row) => ({
    ...row,
    tracks: (row.tracks ?? []).map((track) => ({ ...track, uploader: meta.get(track.videoId)?.channelTitle ?? null })),
  }))
  const all = withUploader.flatMap((row) => row.tracks.map((track) => ({ ...track, artist: row.name, decade: row.decade })))
  const count = (test) => all.filter(test).length
  const summary = {
    sampled: rows.length,
    errors: rows.filter((row) => row.error).length,
    artistsWithSongs: withUploader.filter((row) => row.tracks.length > 0).length,
    byStratum: Object.fromEntries(
      ['random', 'non-latin'].map((stratum) => {
        const list = withUploader.filter((row) => row.stratum === stratum)
        return [stratum, { of: list.length, withSongs: list.filter((row) => row.tracks.length > 0).length, needsSearch: list.filter((row) => row.needsSearch).length }]
      }),
    ),
    searchesSpent: SEARCH_BUDGET - searchesLeft,
    tracks: all.length,
    bySource: { channel: count((t) => t.source === 'channel'), discogs: count((t) => t.source === 'discogs'), search: count((t) => t.source === 'search') },
    byChannelMatch: Object.fromEntries(['mb-link', 'learned', 'name', 'alias', 'both-scripts'].map((kind) => [kind, count((t) => t.how?.channel === kind)])),
    byWork: Object.fromEntries(['release', 'song', 'discogs'].map((kind) => [kind, count((t) => t.how?.work === kind)])),
  }
  writeFileSync(OUT, JSON.stringify({ summary, rows: withUploader }, null, 1))
  log(JSON.stringify(summary, null, 2))
}

await main()
