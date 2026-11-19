/**
 * MEASURE ONLY (owner briefs Nov 18–19, 2026, the Egypt 1966 follow-up):
 * would the queue's search path find more songs for artists whose
 * MusicBrainz name is in a non-Latin script under two changes —
 *   (1) also accept a channel named the MB name plus an allowed alias,
 *       in either order ("أم كلثوم Umm Kulthum"), or the alias alone;
 *   (2) confirm with any of the MBID's own MB song (recording) titles,
 *       not only the era pick's release title?
 * Owner's terms: exact matches only, no fuzzy matching, aliases typed
 * "Artist name" / "Legal name" only, a title must still match. NOTHING
 * here changes the site; the rules are not built until the owner has
 * seen these numbers and approved them.
 *
 * Per sampled artist (data/alias-match-sample-list.json):
 *   1. the route's own MusicBrainz release-group call (limit 100),
 *      era-ranked as the route does (dating corrections included), and
 *      one recording browse (limit 100) for song titles + dates;
 *   2. the route's own search (MB name + era title) — 100 units AND one
 *      of YouTube's separate "Search Queries per day", a cap the live
 *      site shares. So searches run only inside a night window just
 *      after the midnight-Pacific reset, a few per night (--max);
 *   3. every stored answer judged under every bar at once — re-judging
 *      never needs a new search:
 *        T       today:      channel = MB name;                  title ⊇ era pick
 *        A       alias:      channel = MB name or a typed alias; title ⊇ era pick
 *        B       two-script: A, or "name alias" / "alias name";  title ⊇ era pick
 *        T+song / A+song / B+song: title ⊇ the era pick OR any MB song title
 *      (B+song is the owner's two-change version; the rest attribute it);
 *   4. accepted hits run the route's gates (non-song title, self-titled,
 *      then playability + non-music verdicts: one videos.list, 1 unit).
 *
 *   node --env-file=.env.local --import ./scripts/test/resolve-ts.mjs \
 *     scripts/measure-alias-match.mjs [flags]
 *   (no flags)          re-judge stored answers + write the report; no searches
 *   --preview           picks and queries only, zero YouTube calls
 *   --run [--max N]     search up to N new artists (default 6), only between
 *                       00:00 and 05:59 America/Los_Angeles; stops on the
 *                       first refusal. Prints COMPLETE when nothing is left.
 *   --extend N          add N seeded-random artists from the census population
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  isNonSongUpload,
  isSelfTitled,
  namesTheSelfTitledRecord,
  nonMusicVerdict,
} from '../lib/play/contentGates.ts'
import { playableSet } from '../lib/play/channelSongs.ts'
import { releaseGroupsFor } from './lib/mbDumpIndex.mjs'

const argOf = (flag, fallback) => {
  const at = process.argv.indexOf(flag)
  return at === -1 ? fallback : process.argv[at + 1]
}
const PREVIEW = process.argv.includes('--preview')
const RUN = process.argv.includes('--run')
const MAX = Number(argOf('--max', '6'))
const EXTEND = Number(argOf('--extend', '0'))
const SAMPLE_PATH = 'data/alias-match-sample-list.json'
const STATE_PATH = 'data/alias-match-sample.json'
const REPORT_PATH = 'data/alias-match-report.json'
const CENSUS_PATH = 'data/alias-match-census.json'
const USER_AGENT = 'EarClefExplore/0.1 (https://earclef.com)'
const SEARCH_GAP_MS = 8000
const MB_GAP_MS = 1500
/** Night window after YouTube's midnight-Pacific reset, when the site is quiet. */
const WINDOW_END_HOUR = 6
const SEED = 20261119
/**
 * A matched song title this short is flagged for hand review, not
 * trusted blind. Counted in letters; a Han/kana/Hangul character
 * carries a word's worth, so those titles get their own floor.
 */
const SHORT_TITLE = 5
const SHORT_TITLE_CJK = 2
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const isShortTitle = (title) => {
  const letters = normalize(title).replace(/ /g, '')
  return letters.length < (CJK.test(letters) ? SHORT_TITLE_CJK : SHORT_TITLE)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const normalize = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

function datingFor(mbid) {
  const path = `lib/explore/rg-dating/${mbid.slice(0, 2)}.json`
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))[mbid] ?? null
}

/** Port of rankEraTitles in app/api/queue/artist/[mbid]/[decade]/route.ts. */
function rankEraTitles(groups, decade, dating) {
  const mid = decade + 5
  const typeRank = (type) => (type === 'Single' ? 0 : type === 'EP' ? 1 : type === 'Album' ? 2 : 3)
  const dated = []
  const undated = []
  for (const group of groups) {
    if (!group.title) continue
    const songYear = dating?.s[normalize(group.title)]
    const albumSpan = group.id ? dating?.a[group.id] : undefined
    const mbYear = Number(group['first-release-date']?.slice(0, 4))
    const type = group['primary-type'] ?? ''
    if (songYear !== undefined) dated.push({ title: group.title, lo: songYear, hi: songYear, type, corrected: true })
    else if (albumSpan !== undefined) dated.push({ title: group.title, lo: albumSpan[0], hi: albumSpan[1], type, corrected: true })
    else if (group['first-release-date'] && Number.isFinite(mbYear)) dated.push({ title: group.title, lo: mbYear, hi: mbYear, type, corrected: false })
    else undated.push(group.title)
  }
  const distance = (g) => (g.lo > mid ? g.lo - mid : g.hi < mid ? mid - g.hi : 0)
  const inBand = (g) => g.lo <= decade + 9 && g.hi >= decade
  const ranked = [
    ...dated.filter(inBand).sort((a, b) => typeRank(a.type) - typeRank(b.type) || distance(a) - distance(b)).map((g) => ({ title: g.title, era: 'in-era' })),
    ...dated.filter((g) => !inBand(g) && distance(g) <= 15).sort((a, b) => distance(a) - distance(b)).map((g) => ({ title: g.title, era: 'nearby' })),
    ...dated.filter((g) => distance(g) > 15 && !g.corrected).sort((a, b) => distance(a) - distance(b)).map((g) => ({ title: g.title, era: 'catalog' })),
    ...undated.map((title) => ({ title, era: 'catalog' })),
  ]
  const seen = new Set()
  return ranked.filter((entry) => {
    const key = normalize(entry.title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Same bands as the route: in the decade, within 15 of mid-decade, or beyond. */
function eraOfYear(year, decade) {
  if (!Number.isFinite(year)) return 'undated'
  if (year >= decade && year <= decade + 9) return 'in-era'
  return Math.abs(year - (decade + 5)) <= 15 ? 'nearby' : 'catalog'
}

async function mbJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) })
    if (res.ok) return res.json()
    if (res.status !== 503 && res.status !== 429) throw new Error(`MusicBrainz HTTP ${res.status}`)
    await sleep(2500 * attempt)
  }
  throw new Error('MusicBrainz rate limited')
}

async function catalogOf(mbid) {
  const groups = (await mbJson(`https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`))['release-groups'] ?? []
  await sleep(MB_GAP_MS)
  const recordings = (await mbJson(`https://musicbrainz.org/ws/2/recording?artist=${mbid}&limit=100&fmt=json`)).recordings ?? []
  await sleep(MB_GAP_MS)
  const songs = new Map()
  for (const recording of recordings) {
    if (!recording.title) continue
    const year = Number(recording['first-release-date']?.slice(0, 4))
    const held = songs.get(recording.title)
    // Earliest known release year per title — when the song first appeared.
    if (!held || (Number.isFinite(year) && !(held.y <= year))) songs.set(recording.title, { t: recording.title, y: Number.isFinite(year) ? year : null })
  }
  return { groups, songs: [...songs.values()] }
}

/** Returns the parsed search body, or null after printing YouTube's refusal. */
async function search(query, apiKey) {
  await sleep(SEARCH_GAP_MS)
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query)}&key=${apiKey}`,
    { signal: AbortSignal.timeout(10000) },
  )
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body
  const error = body.error ?? {}
  process.stdout.write(
    `SEARCH REFUSED ${res.status} ${error.status ?? ''} ${(error.errors ?? []).map((entry) => entry.reason).join(',')} — ${(error.message ?? '').replace(/key=[^&\s]+/g, 'key=…')}\n`,
  )
  return null
}

function pacificHour() {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Los_Angeles' }).format(new Date()))
}

// ---- sample extension (seeded, proportional by script) -------------------
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function extendSample(sample, count) {
  const { rows } = JSON.parse(readFileSync(CENSUS_PATH, 'utf8'))
  const taken = new Set(sample.map((entry) => entry.id))
  // The population the live route would SEARCH for: an allowed alias, no
  // MB-linked channel (that path runs first), and at least one release
  // title (no title, no search).
  const population = rows.filter(
    (row) => row.latinAliases.length > 0 && !row.youtube && !taken.has(row.id) && (releaseGroupsFor(row.id) ?? []).some((group) => group.title),
  )
  const byScript = new Map()
  for (const row of population) byScript.set(row.script, [...(byScript.get(row.script) ?? []), row])
  // Largest-remainder allocation, so the sample mirrors the population's scripts.
  const quotas = [...byScript].map(([script, list]) => {
    const exact = (count * list.length) / population.length
    return { script, list, n: Math.floor(exact), rest: exact - Math.floor(exact) }
  })
  let left = count - quotas.reduce((sum, quota) => sum + quota.n, 0)
  for (const quota of [...quotas].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break
    quota.n += 1
    left -= 1
  }
  const random = mulberry32(SEED + sample.length)
  const added = []
  for (const { script, list, n } of quotas) {
    const pool = [...list]
    for (let i = 0; i < n && pool.length > 0; i++) {
      const row = pool.splice(Math.floor(random() * pool.length), 1)[0]
      const pairs = Object.entries(row.places).flatMap(([place, decades]) => decades.map((decade) => [place, Number(decade)]))
      const [place, decade] = pairs[Math.floor(random() * pairs.length)]
      added.push({ id: row.id, name: row.name, script, aliases: row.latinAliases, place, decade, stratum: 'random' })
    }
  }
  return [...sample.map((entry) => ({ stratum: 'prominent', ...entry })), ...added]
}

// ---- judging -----------------------------------------------------------
const VARIANTS = ['T', 'A', 'B', 'T+song', 'A+song', 'B+song']

/** Candidates under each bar, in the route's order: bar → top 3 → title gates. */
function judge(entry) {
  const own = normalize(entry.name)
  const aliases = new Set(entry.aliases)
  const twoScript = new Set(entry.aliases.flatMap((alias) => [`${own} ${alias}`, `${alias} ${own}`]))
  const bars = {
    T: (channel) => channel === own,
    A: (channel) => channel === own || aliases.has(channel),
    B: (channel) => channel === own || aliases.has(channel) || twoScript.has(channel),
  }
  const out = {}
  // "+song" WIDENS the confirming titles, never narrows them: the era
  // pick stays first (its era is the route's own), then every MB song.
  const pickWork = { t: entry.pick.title, y: null, pick: true }
  for (const variant of VARIANTS) {
    const songLevel = variant.endsWith('+song')
    const works = songLevel ? [pickWork, ...entry.songs] : [pickWork]
    out[variant] = entry.items
      .map((item) => {
        const video = normalize(item.title)
        const work = works.find((song) => normalize(song.t) && video.includes(normalize(song.t)))
        return { ...item, work }
      })
      .filter((item) => item.videoId && item.work && bars[variant.split('+')[0]](normalize(item.channelTitle.replace(/ - topic$/i, ''))))
      .slice(0, 3)
      .filter((item) => !isNonSongUpload(item.title, item.work.t, entry.name))
      .filter((item) => !isSelfTitled(item.work.t, entry.name) || namesTheSelfTitledRecord(item.title, item.work.t, entry.name))
  }
  return out
}

// ---- main --------------------------------------------------------------
let sample = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'))
if (EXTEND > 0) {
  sample = extendSample(sample, EXTEND)
  writeFileSync(SAMPLE_PATH, JSON.stringify(sample, null, 1))
  process.stdout.write(`sample extended to ${sample.length}\n`)
}
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {}
const apiKey = process.env.YOUTUBE_API_KEY
if (!PREVIEW && !apiKey) throw new Error('YOUTUBE_API_KEY missing (run with --env-file=.env.local)')

const remaining = () => sample.filter((artist) => !state[`${artist.id}:${artist.decade}`]?.items && state[`${artist.id}:${artist.decade}`]?.pick !== null)
let searches = 0
const inWindow = pacificHour() < WINDOW_END_HOUR
if (RUN && !inWindow) process.stdout.write(`outside the night window (Pacific hour ${pacificHour()}, window 0–${WINDOW_END_HOUR - 1}) — no searches this run\n`)
for (const artist of sample) {
  const key = `${artist.id}:${artist.decade}`
  const known = state[key] ?? {}
  // Song titles as {t, y}: entries from the first run stored bare strings.
  if (!known.songs || typeof known.songs[0] === 'string') {
    const { groups, songs } = await catalogOf(artist.id)
    const pick = known.pick !== undefined ? known.pick : rankEraTitles(groups, artist.decade, datingFor(artist.id))[0] ?? null
    state[key] = { ...known, ...artist, pick, songs, query: pick ? `${artist.name} ${pick.title}` : null }
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 1))
  }
  const entry = state[key]
  if (PREVIEW) {
    process.stdout.write(`${artist.script.padEnd(14)} ${artist.place}-${artist.decade} ${artist.name} → ${entry.pick ? `${entry.pick.era}: ${entry.pick.title}` : 'NO TITLE (the route never searches)'}\n`)
    continue
  }
  if (!entry.items && RUN && inWindow && entry.pick && searches < MAX) {
    const body = await search(entry.query, apiKey)
    if (!body) break
    searches += 1
    state[key] = {
      ...entry,
      searchedAt: new Date().toISOString(),
      items: (body.items ?? []).map((item) => ({
        videoId: item.id?.videoId,
        title: item.snippet?.title ?? '',
        channelTitle: item.snippet?.channelTitle ?? '',
      })),
    }
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 1))
  }
}
if (PREVIEW) process.exit(0)

// Judge every stored answer under every bar; one batched gate check.
const judged = sample
  .map((artist) => state[`${artist.id}:${artist.decade}`])
  .filter((entry) => entry?.items)
  .map((entry) => ({ entry, variants: judge(entry) }))
const ids = [...new Set(judged.flatMap(({ variants }) => Object.values(variants).flat().map((item) => item.videoId)))]
const { playable, meta } = ids.length ? await playableSet(ids, apiKey) : { playable: new Set(), meta: new Map() }
const tally = (rows) => Object.fromEntries(VARIANTS.map((variant) => [variant, rows.filter((row) => row.kept[variant].length > 0).length]))
const results = []
for (const { entry, variants } of judged) {
  const kept = {}
  for (const variant of VARIANTS) {
    kept[variant] = variants[variant]
      .filter((item) => {
        const facts = meta.get(item.videoId)
        return (
          playable.has(item.videoId) &&
          nonMusicVerdict({ title: item.title, workTitle: item.work.t, artistName: entry.name, topicUrls: facts?.topicUrls, description: facts?.description }).reasons.length === 0
        )
      })
      .map((item) => ({
        videoId: item.videoId,
        title: item.title,
        channel: item.channelTitle,
        work: item.work.t,
        era: item.work.pick ? entry.pick.era : eraOfYear(item.work.y, entry.decade),
        ...(isShortTitle(item.work.t) ? { review: 'short title' } : {}),
      }))
  }
  state[`${entry.id}:${entry.decade}`] = { ...entry, verdicts: kept }
  results.push({ name: entry.name, script: entry.script, stratum: entry.stratum ?? 'prominent', place: `${entry.place}-${entry.decade}`, kept })
  process.stdout.write(`${entry.name.padEnd(30)} ${VARIANTS.map((variant) => `${variant}:${kept[variant].length}`).join('  ')}\n`)
}
writeFileSync(STATE_PATH, JSON.stringify(state, null, 1))

const noTitle = sample.filter((artist) => state[`${artist.id}:${artist.decade}`]?.pick === null).length
const left = remaining().length
const report = {
  updatedAt: new Date().toISOString(),
  sampled: sample.length,
  searched: judged.length,
  noTitleNoSearch: noTitle,
  leftToSearch: left,
  gainingAtLeastOneSong: tally(results),
  byStratum: Object.fromEntries(['prominent', 'random'].map((stratum) => [stratum, { searched: results.filter((row) => row.stratum === stratum).length, gaining: tally(results.filter((row) => row.stratum === stratum)) }])),
  newUnderTwoChange: results
    .filter((row) => row.kept['B+song'].length > 0 && row.kept.T.length === 0)
    .map((row) => ({ name: row.name, script: row.script, place: row.place, songs: row.kept['B+song'] })),
}
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1))
process.stdout.write(
  `\nsearched ${judged.length} of ${sample.length} · this run ${searches} searches (≈${searches * 100} units)\n` +
    `artists gaining ≥1 song: ${VARIANTS.map((variant) => `${variant} ${report.gainingAtLeastOneSong[variant]}`).join(' · ')}\n` +
    (left === 0 ? 'COMPLETE — every sampled artist has been searched\n' : `${left} left to search\n`),
)
