/**
 * MEASURE ONLY — how the live site spends YouTube searches, and how
 * many of them the local Discogs video lists could replace.
 *
 * Owner brief Nov 19, 2026: the project's "Search Queries per day" cap
 * is 100. The queue route (app/api/queue/artist/[mbid]/[decade]) runs
 * ONE search for an artist × decade when the artist has release-group
 * titles but no MB-linked channel upload matching them. Answers are
 * cached per artist × decade (hits forever, nulls 30 days), so a cold
 * place-year costs one search per such artist the player walks.
 *
 * Stage 1 (default, zero quota): rebuild every place-year pool the way
 * the census does, classify each pooled artist, and count the searches
 * a cold walk would spend. Then look up each search-bound artist's
 * Discogs records (MB discogs url-rel → local videos-by-artist index)
 * and keep the videos whose Discogs title contains one of the artist's
 * MB release-group titles — candidates that need no search.
 *
 * Stage 2 (--verify N, videos.list only, NO search): a seeded random
 * sample of N candidate-bearing artists goes through the SAME checks as
 * today's search path — channel (minus " - Topic") equals the MB name,
 * title contains a release-group title, playable, non-song and
 * non-music gates. 1 unit per 50 ids from the 10,000-a-day bucket.
 *
 *   node --max-old-space-size=12288 scripts/measure-search-budget.mjs
 *   node --env-file=.env.local --no-warnings --max-old-space-size=4096 \
 *     --import ./scripts/test/resolve-ts.mjs scripts/measure-search-budget.mjs --verify 150
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const ROOT = process.cwd()
const CENSUS_OUT = join(ROOT, 'data/search-budget-census.json')
/** The verify stage's sampling frame — ~45 MB, kept local (not committed). */
const FRAME_OUT = join(ROOT, 'data/search-budget-frame.json')
const VERIFY_OUT = join(ROOT, 'data/search-budget-verify.json')
const POOL_LIMIT = 300
const UNDATED_FLOOR = 1980
const INITIAL_BATCH = 15
const CANDIDATE_CAP = 24
const SEED = 20261119

const normalize = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const LATIN = /\p{Script=Latin}/u
const lettersOf = (value) => value.match(/\p{L}/gu) ?? []
const hasNoLatin = (value) => {
  const letters = lettersOf(value)
  return letters.length > 0 && !letters.some((ch) => LATIN.test(ch))
}
const log = (line) => process.stdout.write(`${line}\n`)

function readGzJsonl(path) {
  return gunzipSync(readFileSync(path))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return { n: sorted.length, median: at(0.5), p75: at(0.75), p90: at(0.9), p99: at(0.99), max: sorted.at(-1) ?? 0 }
}

// ---- places (same rebuild as measure-alias-census.mjs) -----------------
function loadPlaces() {
  const places = new Map()
  const countryDir = join(ROOT, 'lib/explore/country-artists')
  for (const file of readdirSync(countryDir)) {
    const stored = JSON.parse(readFileSync(join(countryDir, file), 'utf8'))
    places.set(file.replace('.json', ''), { name: stored.name, artists: stored.artists })
  }
  for (const file of ['state-artists.json', 'uk-nation-artists.json']) {
    const stored = JSON.parse(readFileSync(join(ROOT, 'lib/explore', file), 'utf8'))
    for (const [code, region] of Object.entries(stored.states)) {
      places.set(code, { name: code, artists: region.artists })
    }
  }
  const historical = JSON.parse(readFileSync(join(ROOT, 'lib/explore/historical-area-artists.json'), 'utf8'))
  for (const [code, list] of Object.entries(historical.countries)) {
    const place = places.get(code)
    if (!place) continue
    const held = new Set(place.artists.map((artist) => artist.id))
    const extra = list
      .filter((artist) => !held.has(artist.mbid))
      .map((artist) => ({ id: artist.mbid, name: artist.name, cs: artist.lifeBegin ?? null, end: artist.lifeEnd ?? null, w: artist.votes ?? 0 }))
    places.set(code, { ...place, artists: [...place.artists, ...extra] })
  }
  return places
}

/** Calls visit(code, year, orderedPoolArtists) for every place-year. */
function walkPools(places, visit) {
  for (const [code, place] of places) {
    const ordered = [
      ...place.artists.filter((artist) => artist.cs !== null).sort((a, b) => b.w - a.w),
      ...place.artists.filter((artist) => artist.cs === null).sort((a, b) => b.w - a.w),
    ]
    for (let year = 1900; year <= 2026; year++) {
      const pool = []
      for (const artist of ordered) {
        if (pool.length >= POOL_LIMIT) break
        if (artist.cs !== null && artist.cs > year) continue
        if (artist.end !== null && artist.end < year) continue
        if (artist.cs === null && year < UNDATED_FLOOR) continue
        pool.push(artist)
      }
      if (pool.length > 0) visit(code, year, pool)
    }
  }
}

// ---- stage 1 -----------------------------------------------------------
function census() {
  const places = loadPlaces()
  const names = new Map()
  walkPools(places, (_code, _year, pool) => {
    for (const artist of pool) names.set(artist.id, artist.name)
  })
  log(`pooled artists ${names.size} · places ${places.size}`)

  const links = new Map()
  const linksDir = join(ROOT, 'data/mb-dump/artist-links')
  for (const file of readdirSync(linksDir)) {
    for (const line of readFileSync(join(linksDir, file), 'utf8').split('\n')) {
      if (!line.startsWith('{"a":"')) continue
      const id = line.slice(6, 42)
      if (!names.has(id)) continue
      const row = JSON.parse(line)
      links.set(id, { yt: (row.yt ?? []).length > 0, dg: (row.dg ?? []).map(Number).filter(Number.isInteger) })
    }
  }
  log(`links read for ${links.size}`)

  const titles = new Map()
  const rgDir = join(ROOT, 'data/mb-dump/rg-by-artist')
  for (const file of readdirSync(rgDir)) {
    for (const line of readFileSync(join(rgDir, file), 'utf8').split('\n')) {
      if (!line.startsWith('{"a":"')) continue
      const id = line.slice(6, 42)
      if (!names.has(id)) continue
      const row = JSON.parse(line)
      const key = normalize(row.t)
      if (!key) continue
      const list = titles.get(id) ?? []
      if (!list.some((entry) => entry.key === key)) {
        list.push({ key, title: row.t, year: Number(String(row.d ?? '').slice(0, 4)) || null })
      }
      titles.set(id, list)
    }
  }
  log(`release-group titles for ${titles.size}`)

  /** search = no MB channel, has titles: the route's search path. */
  const kindOf = (id) => {
    if (!titles.has(id)) return 'noTitle'
    if (links.get(id)?.yt) return 'channel'
    return hasNoLatin(names.get(id) ?? '') ? 'searchNonLatin' : 'searchLatin'
  }

  const pairs = new Map()
  const perPool = []
  walkPools(places, (code, year, pool) => {
    const decade = Math.floor(year / 10) * 10
    const counts = { pool: pool.length, noTitle: 0, channel: 0, searchLatin: 0, searchNonLatin: 0 }
    let firstBatchSearch = 0
    pool.forEach((artist, index) => {
      const kind = kindOf(artist.id)
      counts[kind] += 1
      if (kind.startsWith('search') && index < INITIAL_BATCH) firstBatchSearch += 1
      pairs.set(`${artist.id}|${decade}`, kind)
    })
    perPool.push({ code, year, ...counts, search: counts.searchLatin + counts.searchNonLatin, firstBatchSearch })
  })

  const pairCounts = {}
  for (const kind of pairs.values()) pairCounts[kind] = (pairCounts[kind] ?? 0) + 1
  const searchArtists = new Set(
    [...pairs].filter(([, kind]) => kind.startsWith('search')).map(([key]) => key.split('|')[0]),
  )
  const searchPairs = (pairCounts.searchLatin ?? 0) + (pairCounts.searchNonLatin ?? 0)
  log(`search-bound pairs ${searchPairs} across ${searchArtists.size} artists`)

  // ---- Discogs candidates for search-bound artists ----------------------
  const wantedDg = new Map()
  for (const id of searchArtists) {
    for (const dg of links.get(id)?.dg ?? []) {
      const list = wantedDg.get(dg) ?? []
      list.push(id)
      wantedDg.set(dg, list)
    }
  }
  const refsByArtist = new Map()
  const vbaDir = join(ROOT, 'data/discogs-dump/index/videos-by-artist')
  for (const file of readdirSync(vbaDir)) {
    for (const row of readGzJsonl(join(vbaDir, file))) {
      if (row.k === 'x' || !wantedDg.has(row.a)) continue
      for (const id of wantedDg.get(row.a)) {
        const set = refsByArtist.get(id) ?? new Set()
        set.add(row.r)
        refsByArtist.set(id, set)
      }
    }
  }
  log(`artists with a video-bearing Discogs record ${refsByArtist.size}`)

  const releaseToArtists = new Map()
  for (const [id, releases] of refsByArtist) {
    for (const releaseId of releases) {
      const list = releaseToArtists.get(releaseId) ?? []
      list.push(id)
      releaseToArtists.set(releaseId, list)
    }
  }
  const byShard = new Map()
  for (const releaseId of releaseToArtists.keys()) {
    const shard = (releaseId % 256).toString(16).padStart(2, '0')
    const set = byShard.get(shard) ?? new Set()
    set.add(releaseId)
    byShard.set(shard, set)
  }
  const candidates = new Map()
  const vrDir = join(ROOT, 'data/discogs-dump/index/video-releases')
  let shardsDone = 0
  for (const [shard, wanted] of byShard) {
    for (const row of readGzJsonl(join(vrDir, `${shard}.jsonl.gz`))) {
      if (!wanted.has(row.i)) continue
      for (const id of releaseToArtists.get(row.i)) {
        const own = titles.get(id) ?? []
        for (const [url, videoTitle] of row.vs ?? []) {
          const videoId = url.match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/)
          const vid = videoId?.[1] ?? videoId?.[2]
          if (!vid) continue
          const key = normalize(videoTitle)
          const match = own.find((entry) => key.includes(entry.key))
          if (!match) continue
          const list = candidates.get(id) ?? []
          if (!list.some((entry) => entry.videoId === vid)) {
            list.push({ videoId: vid, discogsTitle: videoTitle, work: match.title, workYear: match.year })
          }
          candidates.set(id, list)
        }
      }
    }
    shardsDone += 1
    if (shardsDone % 32 === 0) log(`  release shards ${shardsDone}/${byShard.size}`)
  }
  log(`artists with a title-bar Discogs candidate ${candidates.size}`)

  const latinSearch = [...searchArtists].filter((id) => !hasNoLatin(names.get(id) ?? ''))
  const nonLatinSearch = [...searchArtists].filter((id) => hasNoLatin(names.get(id) ?? ''))
  const share = (list, has) => ({ of: list.length, n: list.filter(has).length })
  const pairsWithCandidate = [...pairs].filter(
    ([key, kind]) => kind.startsWith('search') && candidates.has(key.split('|')[0]),
  ).length

  const egypt1966 = perPool.find((row) => row.code === 'EG' && row.year === 1966)
  const hungriest = [...perPool].sort((a, b) => b.search - a.search).slice(0, 12)
  const summary = {
    snapshot: 'MB JSON dump 2026-08-29 + Discogs dump 2026-09-01 (local indexes)',
    pooledArtists: names.size,
    placeYears: perPool.length,
    artistDecadePairs: pairs.size,
    pairsByKind: pairCounts,
    searchBoundPairs: searchPairs,
    searchBoundArtists: searchArtists.size,
    pairsPerSearchArtist: Number((searchPairs / searchArtists.size).toFixed(2)),
    daysToSearchEveryPairOnceAt100: Math.ceil(searchPairs / 100),
    coldWalkSearchesPerPlaceYear: quantiles(perPool.map((row) => row.search)),
    coldWalkNonLatinSearchesPerPlaceYear: quantiles(perPool.map((row) => row.searchNonLatin)),
    placeYearsOver100Searches: perPool.filter((row) => row.search > 100).length,
    placeYearsOver50Searches: perPool.filter((row) => row.search > 50).length,
    firstBatchSearchesPerPlaceYear: quantiles(perPool.map((row) => row.firstBatchSearch)),
    egypt1966,
    hungriest,
    discogs: {
      searchBoundWithDiscogsLink: share([...searchArtists], (id) => (links.get(id)?.dg ?? []).length > 0),
      searchBoundWithVideoRecord: share([...searchArtists], (id) => refsByArtist.has(id)),
      searchBoundWithTitleBarCandidate: share([...searchArtists], (id) => candidates.has(id)),
      latinWithTitleBarCandidate: share(latinSearch, (id) => candidates.has(id)),
      nonLatinWithTitleBarCandidate: share(nonLatinSearch, (id) => candidates.has(id)),
      searchBoundPairsWithCandidate: pairsWithCandidate,
    },
  }
  const sampleFrame = [...candidates.keys()].map((id) => ({
    id,
    name: names.get(id),
    nonLatin: hasNoLatin(names.get(id) ?? ''),
    candidates: candidates.get(id).slice(0, CANDIDATE_CAP),
  }))
  writeFileSync(CENSUS_OUT, JSON.stringify({ summary }, null, 1))
  writeFileSync(FRAME_OUT, JSON.stringify(sampleFrame))
  log(JSON.stringify(summary, null, 2))
}

// ---- stage 2 -----------------------------------------------------------
function mulberry32(seed) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function verify(size) {
  if (!existsSync(FRAME_OUT)) throw new Error('Run the census first (no flags).')
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY missing — run with --env-file=.env.local')
  const { playableSet } = await import('../lib/play/channelSongs.ts')
  const { isNonSongUpload, isSelfTitled, namesTheSelfTitledRecord, nonMusicVerdict } = await import(
    '../lib/play/contentGates.ts'
  )
  const sampleFrame = JSON.parse(readFileSync(FRAME_OUT, 'utf8'))
  const random = mulberry32(SEED)
  const shuffled = sampleFrame
    .map((row) => ({ row, r: random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ row }) => row)
  const sample = shuffled.slice(0, size)
  const ids = [...new Set(sample.flatMap((row) => row.candidates.map((candidate) => candidate.videoId)))]
  const playable = new Set()
  const meta = new Map()
  for (let at = 0; at < ids.length; at += 50) {
    const batch = await playableSet(ids.slice(at, at + 50), key)
    for (const id of batch.playable) playable.add(id)
    for (const [id, facts] of batch.meta) meta.set(id, facts)
  }
  log(`videos.list calls ${Math.ceil(ids.length / 50)} for ${ids.length} ids`)

  const results = sample.map((row) => {
    const artist = normalize(row.name)
    const verified = row.candidates.filter((candidate) => {
      const facts = meta.get(candidate.videoId)
      if (!facts || !playable.has(candidate.videoId) || !artist) return false
      const channel = normalize((facts.channelTitle ?? '').replace(/ - topic$/i, ''))
      if (channel !== artist) return false
      const title = candidate.discogsTitle
      if (isNonSongUpload(title, candidate.work, row.name)) return false
      if (isSelfTitled(candidate.work, row.name) && !namesTheSelfTitledRecord(title, candidate.work, row.name)) {
        return false
      }
      return (
        nonMusicVerdict({
          title,
          workTitle: candidate.work,
          artistName: row.name,
          topicUrls: facts.topicUrls,
          description: facts.description,
        }).reasons.length === 0
      )
    })
    const live = row.candidates.filter((candidate) => meta.has(candidate.videoId)).length
    return {
      id: row.id,
      name: row.name,
      nonLatin: row.nonLatin,
      candidates: row.candidates.length,
      stillOnYoutube: live,
      verified: verified.map((candidate) => ({
        videoId: candidate.videoId,
        title: candidate.discogsTitle,
        channel: meta.get(candidate.videoId)?.channelTitle,
        work: candidate.work,
        workYear: candidate.workYear,
      })),
    }
  })
  const gained = results.filter((row) => row.verified.length > 0)
  const summary = {
    sampled: results.length,
    seed: SEED,
    videosListCalls: Math.ceil(ids.length / 50),
    searchesUsed: 0,
    artistsWithVerifiedSong: gained.length,
    latin: { of: results.filter((row) => !row.nonLatin).length, n: gained.filter((row) => !row.nonLatin).length },
    nonLatin: { of: results.filter((row) => row.nonLatin).length, n: gained.filter((row) => row.nonLatin).length },
    verifiedSongs: gained.reduce((total, row) => total + row.verified.length, 0),
  }
  writeFileSync(VERIFY_OUT, JSON.stringify({ summary, results }, null, 1))
  log(JSON.stringify(summary, null, 2))
}

const flag = process.argv.indexOf('--verify')
if (flag === -1) census()
else await verify(Number(process.argv[flag + 1] ?? 150))
