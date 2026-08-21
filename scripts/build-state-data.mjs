/**
 * Region-level precompute: MusicBrainz artists per subdivision of a
 * configured country (US states, UK nations).
 *
 * Discovery casts a wide net — for every configured area name (region +
 * curated music cities) it sweeps `(area:"X" OR beginarea:"X")`, because
 * MB files many artists under a city, or under the plain country
 * with only a birthplace city (The Killers carry area=United States,
 * begin-area=Las Vegas). Assignment is then PRECISE: every hit's area
 * is resolved to its true region by walking MB "part of" parents until
 * a target ISO 3166-2 code appears (Las Vegas → Clark County → Nevada;
 * Manchester → Greater Manchester → England), so cross-region and
 * cross-country name collisions (Portland, Manchester, Bangor…) cost
 * only sweep pages, never accuracy. UK cities carry their OWN ISO
 * 3166-2 codes (Manchester GB-MAN, Glasgow GB-GLG) — the walk continues
 * through non-target subdivision codes and stops only at country codes.
 *
 * Resumable: the region's work file checkpoints finished name sweeps
 * and the area→region cache. Re-run to continue; ~1 req/1.1s.
 *
 * Usage:
 *   node scripts/build-state-data.mjs                        # US, full
 *   node scripts/build-state-data.mjs --region uk            # UK, full
 *   node scripts/build-state-data.mjs --region uk --smoke GB-WLS,GB-NIR
 *
 * Outputs (full run, per region): globe heat counts (public/data),
 * panel dataset (lib/explore), coverage report (data/).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const REGIONS = {
  us: {
    config: 'lib/explore/us-states.json',
    work: 'data/state-precompute-work.json',
    counts: 'public/data/state-year-counts.json',
    artists: 'lib/explore/state-artists.json',
    report: 'data/state-coverage-report.json',
  },
  uk: {
    config: 'lib/explore/uk-nations.json',
    work: 'data/uk-nation-precompute-work.json',
    counts: 'public/data/uk-nation-year-counts.json',
    artists: 'lib/explore/uk-nation-artists.json',
    report: 'data/uk-nation-coverage-report.json',
  },
}

const regionArg = process.argv.indexOf('--region')
const regionKey = regionArg !== -1 ? process.argv[regionArg + 1] : 'us'
const REGION = REGIONS[regionKey]
if (!REGION) {
  throw new Error(`unknown --region "${regionKey}" (${Object.keys(REGIONS).join(', ')})`)
}

const CONFIG_PATH = REGION.config
const WORK_PATH = REGION.work
const COUNTS_OUT = REGION.counts
const ARTISTS_OUT = REGION.artists
const REPORT_OUT = REGION.report

const DELAY_MS = 1100
const MAX_RETRIES = 5
const PAGE_SIZE = 100
const DEFAULT_PAGES = 6
const MAX_PARENT_HOPS = 5
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

/** Live-route parity: a person's career starts ~15y after birth. */
const PERSON_CAREER_OFFSET_YEARS = 15
/** Panel dataset caps: top overall ∪ top per emergence decade. */
const KEEP_TOP_OVERALL = 400
const KEEP_TOP_PER_DECADE = 30
const KEEP_TAGS = 6

const smokeArg = process.argv.indexOf('--smoke')
const smokeStates =
  smokeArg !== -1 ? (process.argv[smokeArg + 1] ?? '').split(',') : null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function mbJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        console.warn(`  rate-limited (${res.status}), backing off ${5 * attempt}s`)
        await sleep(5000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      console.warn(`  attempt ${attempt} failed: ${error.message}`)
      await sleep(5000 * attempt)
    }
  }
  throw new Error('unreachable')
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    console.warn(`${path} unreadable; starting fresh`)
    return fallback
  }
}

function saveWork(work) {
  writeFileSync(WORK_PATH, JSON.stringify(work))
}

/** Sweep one area name across both artist location fields. */
async function sweepName(name, maxPages, hits) {
  const query = encodeURIComponent(`(area:"${name}" OR beginarea:"${name}")`)
  let fetched = 0
  let total = 0
  for (let page = 0; page < maxPages; page++) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${query}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fmt=json`,
    )
    const artists = body.artists ?? []
    for (const artist of artists) {
      if (hits[artist.id]) continue
      const tags = artist.tags ?? []
      hits[artist.id] = {
        id: artist.id,
        name: artist.name,
        type: artist.type,
        begin: artist['life-span']?.begin?.slice(0, 4),
        end: artist['life-span']?.end?.slice(0, 4),
        // Raw [name, count] pairs — significance is computed at
        // aggregate time, where pool-wide tag frequency can expose
        // self-promotional junk tags.
        tags: tags
          .filter((tag) => (tag.count ?? 0) > 0)
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
          .slice(0, 10)
          .map((tag) => [tag.name, tag.count ?? 0]),
        areaId: artist.area?.id,
        areaType: artist.area?.type,
        beginAreaId: artist['begin-area']?.id,
        beginAreaType: artist['begin-area']?.type,
      }
    }
    fetched += artists.length
    total = body.count ?? 0
    if ((page + 1) * PAGE_SIZE >= total || artists.length === 0) break
    await sleep(DELAY_MS)
  }
  return { total, fetched }
}

/**
 * Resolve an MB area to a US state code by walking "part of" parents.
 * Caches every area passed on the way (walking Las Vegas resolves
 * Clark County and Nevada too). Returns a US-XX code or null.
 */
async function resolveArea(areaId, cache, stateCodes) {
  const chain = []
  let currentId = areaId
  for (let hop = 0; hop <= MAX_PARENT_HOPS; hop++) {
    if (cache[currentId] !== undefined) {
      for (const id of chain) cache[id] = cache[currentId]
      return cache[currentId]
    }
    chain.push(currentId)
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/area/${currentId}?inc=area-rels&fmt=json`,
    )
    await sleep(DELAY_MS)

    const iso2 = (body['iso-3166-2-codes'] ?? []).find((code) =>
      stateCodes.has(code),
    )
    if (iso2) {
      for (const id of chain) cache[id] = iso2
      return iso2
    }
    // A country code ends the walk: we climbed past every target
    // subdivision, so this area is outside the region. Non-target
    // ISO 3166-2 codes do NOT stop it — UK cities and counties carry
    // their own codes (Manchester GB-MAN, Essex GB-ESS) below the
    // nation level, and a foreign subdivision simply climbs to its
    // country and resolves null there.
    if ((body['iso-3166-1-codes'] ?? []).length > 0) {
      for (const id of chain) cache[id] = null
      return null
    }

    const partOf = (body.relations ?? []).filter(
      (rel) => rel.type === 'part of' && rel.area,
    )
    const parent =
      partOf.find((rel) => rel.direction === 'backward')?.area ?? partOf[0]?.area
    if (!parent) break
    currentId = parent.id
  }
  for (const id of chain) cache[id] = null
  return null
}

function careerStart(record) {
  const begin = Number(record.begin)
  if (!Number.isFinite(begin)) return null
  return record.type === 'Person' ? begin + PERSON_CAREER_OFFSET_YEARS : begin
}

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Tag-vote weight with the spam filtered out. Self-promotional artists
 * tag themselves with their own name and one-off phrases ("google is
 * my alibi") — a tag earns weight only if it isn't derived from the
 * artist's name and at least MIN_TAG_ARTISTS artists in the whole pool
 * carry it (real genres recur; junk never does).
 */
const MIN_TAG_ARTISTS = 3

function buildTagFrequency(hits) {
  const frequency = new Map()
  for (const record of Object.values(hits)) {
    for (const [tag] of record.tags) {
      frequency.set(tag, (frequency.get(tag) ?? 0) + 1)
    }
  }
  return frequency
}

function credibleTags(record, frequency) {
  const artistNorm = normalize(record.name)
  return record.tags.filter(([tag]) => {
    const tagNorm = normalize(tag)
    if (
      tagNorm.length > 2 &&
      (artistNorm.includes(tagNorm) || tagNorm.includes(artistNorm))
    ) {
      return false
    }
    return (frequency.get(tag) ?? 0) >= MIN_TAG_ARTISTS
  })
}

function aggregate(hits, areaToState, states) {
  const frequency = buildTagFrequency(hits)
  const byState = {}
  for (const state of states) {
    byState[state.code] = {
      name: state.name,
      total: 0,
      undated: 0,
      begins: {},
      ends: {},
      artists: [],
    }
  }

  for (const record of Object.values(hits)) {
    const state =
      (record.areaId && areaToState[record.areaId]) ||
      (record.beginAreaId && areaToState[record.beginAreaId]) ||
      null
    const bucket = state && byState[state]
    if (!bucket) continue

    bucket.total++
    const start = careerStart(record)
    if (start === null) {
      bucket.undated++
    } else {
      bucket.begins[start] = (bucket.begins[start] ?? 0) + 1
    }
    const end = Number(record.end)
    if (Number.isFinite(end)) {
      bucket.ends[end] = (bucket.ends[end] ?? 0) + 1
    }
    const tags = credibleTags(record, frequency)
    bucket.artists.push({
      id: record.id,
      name: record.name,
      cs: start,
      end: Number.isFinite(end) ? end : null,
      w: tags.reduce((sum, [, count]) => sum + count, 0),
      t: tags.slice(0, KEEP_TAGS).map(([tag]) => tag),
    })
  }

  // Cap the stored roster: top overall ∪ top per emergence decade, so
  // a 1920s query still surfaces that era's giants in every state.
  for (const bucket of Object.values(byState)) {
    const sorted = [...bucket.artists].sort((a, b) => b.w - a.w)
    const keep = new Set(sorted.slice(0, KEEP_TOP_OVERALL).map((a) => a.id))
    const byDecade = {}
    for (const artist of sorted) {
      const decade = artist.cs === null ? 'undated' : Math.floor(artist.cs / 10)
      byDecade[decade] ??= []
      if (byDecade[decade].length < KEEP_TOP_PER_DECADE) {
        byDecade[decade].push(artist.id)
      }
    }
    for (const ids of Object.values(byDecade)) {
      for (const id of ids) keep.add(id)
    }
    bucket.artists = sorted.filter((artist) => keep.has(artist.id))
  }
  return byState
}

async function main() {
  mkdirSync('data', { recursive: true })
  const config = loadJson(CONFIG_PATH, null)
  if (!config) throw new Error(`${CONFIG_PATH} missing`)

  const states = smokeStates
    ? config.states.filter((state) => smokeStates.includes(state.code))
    : config.states
  const stateCodes = new Set(config.states.map((state) => state.code))

  // Unique name pool — shared names sweep once, assignment sorts them.
  const names = [...new Set(states.flatMap((state) => state.query))]
  const fresh = { version: 2, doneNames: [], hits: {}, areaCache: {} }
  let work = loadJson(WORK_PATH, fresh)
  if (work.version !== 2) {
    // Hit format changed (per-tag counts); re-sweep, keep the
    // expensive area→state cache.
    work = { ...fresh, areaCache: work.areaCache ?? {} }
  }
  const doneNames = new Set(work.doneNames)

  console.log(
    `${states.length} states, ${names.length} unique area names ` +
      `(${doneNames.size} already swept)`,
  )

  // Phase 1: discovery sweeps.
  for (const [index, name] of names.entries()) {
    if (doneNames.has(name)) continue
    const pages = config.pages?.[name] ?? DEFAULT_PAGES
    const { total, fetched } = await sweepName(name, pages, work.hits)
    doneNames.add(name)
    work.doneNames = [...doneNames]
    saveWork(work)
    console.log(
      `[${index + 1}/${names.length}] ${name}: ${fetched} of ${total} hits ` +
        `(pool ${Object.keys(work.hits).length})`,
    )
    await sleep(DELAY_MS)
  }

  // Phase 2: precise assignment — resolve every distinct area seen.
  const pending = new Set()
  for (const record of Object.values(work.hits)) {
    for (const [id, type] of [
      [record.areaId, record.areaType],
      [record.beginAreaId, record.beginAreaType],
    ]) {
      if (id && type !== 'Country' && work.areaCache[id] === undefined) {
        pending.add(id)
      }
    }
  }
  console.log(`Resolving ${pending.size} distinct areas to states…`)
  let resolved = 0
  for (const areaId of pending) {
    if (work.areaCache[areaId] !== undefined) continue
    await resolveArea(areaId, work.areaCache, stateCodes)
    resolved++
    if (resolved % 25 === 0) {
      saveWork(work)
      console.log(`  ${resolved}/${pending.size} areas resolved`)
    }
  }
  saveWork(work)

  // Phase 3: aggregate and write.
  const byState = aggregate(work.hits, work.areaCache, states)

  const report = Object.fromEntries(
    Object.entries(byState).map(([code, bucket]) => [
      code,
      {
        name: bucket.name,
        artistsOnRecord: bucket.total,
        stored: bucket.artists.length,
        top5: bucket.artists.slice(0, 5).map((artist) => artist.name),
      },
    ]),
  )

  if (smokeStates) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const counts = Object.fromEntries(
    Object.entries(byState).map(([code, bucket]) => [code, bucket.begins]),
  )
  writeFileSync(COUNTS_OUT, JSON.stringify(counts))
  writeFileSync(
    ARTISTS_OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString().slice(0, 10),
      states: Object.fromEntries(
        Object.entries(byState).map(([code, bucket]) => [
          code,
          {
            total: bucket.total,
            undated: bucket.undated,
            begins: bucket.begins,
            ends: bucket.ends,
            artists: bucket.artists,
          },
        ]),
      ),
    }),
  )
  writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2))
  console.log(`Done → ${COUNTS_OUT}, ${ARTISTS_OUT}, ${REPORT_OUT}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
