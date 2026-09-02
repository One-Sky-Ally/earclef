/**
 * STAGE 1 of the era re-dating work (owner-approved Aug 31, 2026):
 * the CENSUS. Sweeps MusicBrainz release groups for every vintage
 * artist in the committed country rosters and records which groups are
 * CANDIDATES for re-dating — nothing more. No dates are changed here,
 * no music is excluded, no queue is touched.
 *
 * THE OWNER'S RULINGS THIS SCRIPT IS BUILT AROUND:
 *   1. Never remove or demote playable music because its date is wrong.
 *      This script only NOMINATES records for research. A nomination is
 *      not a verdict — Stage 2 looks for external evidence and Stage 3
 *      arbitrates. A record with no evidence stays exactly where it is.
 *   2. Same-decade accuracy is a win. A '60s record surfacing in the
 *      '90s is the bug; 1963-for-1958 is not. Hence `displacement` on
 *      every candidate — the census can then show where the real
 *      damage is instead of treating a 3-year drift like a 40-year one.
 *
 * WHY A CANDIDATE IS A CANDIDATE (three independent signals, recorded
 * per candidate so Stage 2 knows what it is testing):
 *   comp       — MB tags the group Compilation. Comps are legitimately
 *                dated at assembly year, so a comp of 1950s sides is
 *                honestly dated 2001 and still wrong for era browsing.
 *   posthumous — dated after the artist's own end year. Half the mass
 *                in the diagnostic probe. Sometimes genuinely posthumous
 *                (an unreleased master finally issued) — evidence tells.
 *   gap        — the artist's EARLIEST dated group falls 25+ years after
 *                their career start, so their whole MB dating is
 *                suspect (Racciatti: career from 1933, earliest group
 *                1977). Nominates the catalog; evidence decides each.
 *
 * TWO CARVE-OUTS, and the reasoning matters more than the rule:
 *   PRE-RECORDING DEATHS are skipped outright (end < 1900). For an
 *   artist who died before commercial recording existed, no original-era
 *   recording CAN exist — every release group is a later performance and
 *   MB's date is already the honest date of that recording. This is a
 *   physical-possibility line, not a taste judgement, which is why it is
 *   the only hard skip. It is what catches the Vivaldi class (85 groups
 *   post-dating him by three centuries).
 *
 *   WESTERN-ART-MUSIC and COMPOSER-CREDITED artists are FLAGGED, NOT
 *   SKIPPED. An earlier draft carved out "classical" wholesale; the tag
 *   census killed it. Maria Callas died in 1977 and her 1950s opera
 *   recordings reissued on 90s CD are EXACTLY the reported bug, while a
 *   1995 recording of a symphony by a composer who died in 1960 is an
 *   honest 1995 recording that must never be re-dated. Those are
 *   opposite answers inside one genre, and `composer` is the 4th most
 *   common tag in this population (1,038 artists) — far too large a
 *   class to decide silently. The census reports both buckets so the
 *   owner rules on them before Stage 2 spends a single lookup.
 *
 * TAG MATCHING IS EXACT, NEVER SUBSTRING. The tag vocabulary contains
 * `classic rock` (84), `classic pop and rock` (138), `baroque pop`,
 * `symphonic prog`, `rock opera`, `new romantic`, and the Dutch
 * `levenslied` (43) / `liedermacher` (23). A regex for /classic|baroque|
 * lied/ would have carved out rock bands and Dutch crooners. Exact
 * set membership makes that whole failure class impossible.
 *
 * Resumable and MONOTONIC: one file per country, merged never replaced,
 * so a run that MusicBrainz refuses can only add rows, never lose them
 * (the Slovakia 1,655→0 lesson from build-country-data.mjs).
 *
 * Usage:
 *   node scripts/build-rg-dating-census.mjs                 # all, resume
 *   node scripts/build-rg-dating-census.mjs --only UY,CU    # named codes
 *   node scripts/build-rg-dating-census.mjs --delay 2500    # gentler
 *   node scripts/build-rg-dating-census.mjs --census        # report only,
 *                                                           # no network
 *   node scripts/build-rg-dating-census.mjs --limit 50      # smoke test
 *
 * Outputs: data/rg-dating-sweep/<CODE>.json (working shards, Stage 2's
 * input) and data/rg-dating-census.json (the G1 report).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  dumpIndexAvailable,
  dumpSnapshot,
  releaseGroupsFor,
} from './lib/mbDumpIndex.mjs'

const ROSTER_DIR = 'lib/explore/country-artists'
const OUT_DIR = 'data/rg-dating-sweep'
const CENSUS_PATH = 'data/rg-dating-census.json'
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

/** Sweep population: began by this year… */
const VINTAGE_CAREER_START = 1975
/** …or finished by this one. Either alone puts an artist in scope. */
const VINTAGE_CAREER_END = 2005
/**
 * Commercial recording begins ~1890s. An artist who died before this
 * cannot have an original-era recording, so their groups are honestly
 * dated as the later performances they are. The one hard skip.
 */
const RECORDING_ERA_START = 1900
/** Earliest-group-minus-career-start gap that makes a catalog suspect. */
const GAP_YEARS = 25
/** Release groups per page, and how many pages before we admit a cap. */
const PAGE_SIZE = 100
const MAX_PAGES = 3
/** Page failures tolerated per artist before moving on. */
const MAX_PAGE_FAILURES = 3
const MAX_RETRIES = 4

const DELAY_MS = (() => {
  const flag = process.argv.indexOf('--delay')
  const value = flag !== -1 ? Number(process.argv[flag + 1]) : NaN
  return Number.isFinite(value) && value >= 1100 ? value : 1100
})()

const onlyArg = process.argv.indexOf('--only')
const onlyCodes =
  onlyArg !== -1
    ? (process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean)
    : null
const limitArg = process.argv.indexOf('--limit')
const artistLimit =
  limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity
const censusOnly = process.argv.includes('--census')
/**
 * Where release groups come from. `dump` reads the local MusicBrainz
 * index (scripts/build-mb-dump-index.mjs) and turns a 15.7-hour API
 * walk into minutes; `api` is the original live path, kept because the
 * dump is a dated snapshot and the API is the thing it is validated
 * against. Default stays `api` so nothing silently changes source.
 */
const sourceArg = process.argv.indexOf('--source')
const SOURCE = sourceArg !== -1 ? process.argv[sourceArg + 1] : 'api'
if (!['api', 'dump'].includes(SOURCE)) {
  throw new Error(`--source must be "api" or "dump", got "${SOURCE}"`)
}

/**
 * Western art music, EXACT match only. Membership does not exclude an
 * artist from the sweep — it buckets them for the owner's ruling.
 */
const ART_MUSIC_TAGS = new Set([
  'classical',
  'contemporary classical',
  'modern classical',
  'romantic classical',
  'cinematic classical',
  'western classical',
  'classical crossover',
  'classical period',
  'baroque',
  'renaissance',
  'medieval',
  'early music',
  'opera',
  'operetta',
  'orchestra',
  'orchestral',
  'symphony',
  'symphony orchestra',
  'chamber orchestra',
  'chamber music',
  'choral',
  'concerto',
  'cantata',
  'art song',
  'lied',
])

/**
 * Non-Western classical traditions are IN SCOPE and bucketed apart: a
 * 1968 Hindustani recording is a real 1968 record whose CD reissue is
 * the same bug as anywhere else. Kept separate only so the owner's
 * ruling on Western art music cannot silently swallow them.
 */
const TRADITION_TAGS = new Set([
  'hindustani classical',
  'indian classical',
  'carnatic classical',
  'persian classical',
  'turkish classical',
  'chinese classical',
  'arabic classical',
  'ottoman classical',
  'korean classical',
  'japanese classical',
])

const COMPOSER_TAGS = new Set(['composer', 'conductor'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function hasTag(record, set) {
  return record.t.some((tag) => set.has(tag.toLowerCase()))
}

/** Every roster artist in scope, with their country attached. */
function loadPopulation() {
  const files = readdirSync(ROSTER_DIR).filter((file) => file.endsWith('.json'))
  const byCountry = new Map()
  for (const file of files) {
    const code = file.replace(/\.json$/, '')
    if (onlyCodes && !onlyCodes.includes(code)) continue
    const stored = JSON.parse(readFileSync(join(ROSTER_DIR, file), 'utf8'))
    const inScope = stored.artists.filter(
      (artist) =>
        (artist.cs !== null && artist.cs <= VINTAGE_CAREER_START) ||
        (artist.end !== null && artist.end <= VINTAGE_CAREER_END),
    )
    if (inScope.length > 0) byCountry.set(code, inScope)
  }
  return byCountry
}

async function mbJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        await sleep(4000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      // MusicBrainz answers "busy" with a 200 and an error body often
      // enough that trusting the status alone loses whole countries.
      if (body.error || !Array.isArray(body['release-groups'])) {
        await sleep(4000 * attempt)
        continue
      }
      return body
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      await sleep(3000 * attempt)
    }
  }
  throw new Error('exhausted retries')
}

/**
 * The same answer as fetchGroups, read from the local dump index.
 * ALWAYS complete and never capped — the paging limit that makes
 * MAX_PAGES necessary against the API does not exist here, so a
 * prolific artist is fully covered rather than truncated at 300.
 */
function dumpGroups(mbid) {
  const groups = releaseGroupsFor(mbid)
  return { groups, total: groups.length, complete: true }
}

/** Every release group MusicBrainz holds for one artist, up to the cap. */
async function fetchGroups(mbid) {
  const collected = []
  let total = 0
  let failures = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    let body
    try {
      body = await mbJson(
        `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fmt=json`,
      )
    } catch {
      failures += 1
      if (failures >= MAX_PAGE_FAILURES) {
        return { groups: collected, total, complete: false }
      }
      await sleep(DELAY_MS)
      continue
    }
    total = body['release-group-count'] ?? collected.length
    collected.push(...body['release-groups'])
    if (collected.length >= total) break
    await sleep(DELAY_MS)
  }
  return {
    groups: collected,
    total,
    complete: collected.length >= total,
  }
}

/**
 * Classify one artist's catalog. Pure — the whole nomination rule lives
 * here so it can be reasoned about (and later re-run over stored
 * shards) without touching the network.
 */
function classify(artist, groups, total, complete) {
  const dated = groups.flatMap((group) => {
    const raw = group['first-release-date'] ?? ''
    const year = Number(raw.slice(0, 4))
    // Missing is not a match: an undated group nominates nothing.
    if (!Number.isFinite(year) || year < 1000) return []
    return [
      {
        id: group.id,
        title: group.title ?? '',
        year,
        type: group['primary-type'] ?? null,
        secondary: group['secondary-types'] ?? [],
      },
    ]
  })

  const earliest = dated.length > 0 ? Math.min(...dated.map((g) => g.year)) : null
  const gapArtist =
    artist.cs !== null && earliest !== null && earliest >= artist.cs + GAP_YEARS

  const candidates = dated.flatMap((group) => {
    const reasons = [
      ...(group.secondary.includes('Compilation') ? ['comp'] : []),
      ...(artist.end !== null && group.year > artist.end ? ['posthumous'] : []),
      ...(gapArtist ? ['gap'] : []),
    ]
    if (reasons.length === 0) return []
    /**
     * How far the MB date sits from where this artist's music lived —
     * as a RANGE, because pre-evidence the true year is genuinely
     * unknown and a single number lies in both directions.
     *
     * An earlier version anchored on the career END alone and buried
     * the reported case: Racciatti died in 2000, so his 2001
     * compilation of 1964 sides scored a displacement of 1 and landed
     * in the "trivial" band — the flagship example of the bug, filed as
     * noise. The material on a compilation can come from anywhere in a
     * career, so the honest statement is a pair of bounds.
     *
     * dispMax — year minus career START. The upper bound: how wrong
     *   this date could possibly be. Racciatti's 2001 comp: 68.
     * dispMin — year minus career END. The floor, and the STRONGER
     *   number where it exists: the artist was already finished, so the
     *   date is displaced by at least this much no matter what the
     *   material is. Null while they were still active.
     */
    const dispMax = artist.cs !== null ? Math.max(0, group.year - artist.cs) : null
    const dispMin =
      artist.end !== null ? Math.max(0, group.year - artist.end) : null
    return [{ ...group, reasons, dispMax, dispMin }]
  })

  return {
    id: artist.id,
    name: artist.name,
    cs: artist.cs,
    end: artist.end,
    tags: artist.t,
    artMusic: hasTag(artist, ART_MUSIC_TAGS),
    tradition: hasTag(artist, TRADITION_TAGS),
    composer: hasTag(artist, COMPOSER_TAGS),
    totalGroups: total,
    datedGroups: dated.length,
    /**
     * Every dated group's year, candidates included. Needed to answer
     * the owner's cost question (Aug 31): once a corrected record LEAVES
     * the era it never belonged to, an artist keeps a decade only if
     * something else of theirs is still eligible for it. The records
     * that stay are the NON-candidates, and their years appear nowhere
     * else in this row — `candidates` holds only the nominated ones.
     */
    years: dated.map((group) => group.year).sort((a, b) => a - b),
    undatedGroups: groups.length - dated.length,
    earliest,
    gapArtist,
    /** False when MusicBrainz refused pages — the row is partial. */
    complete,
    candidates,
  }
}

/**
 * MERGE, NEVER REPLACE (build-country-data.mjs lesson). A re-run that
 * fares worse than the run before must not erase good rows: an artist
 * already swept COMPLETE is never downgraded by a later partial fetch.
 */
function foldIntoStored(existing, swept) {
  const byId = new Map()
  for (const row of existing?.artists ?? []) byId.set(row.id, row)
  for (const row of swept) {
    const held = byId.get(row.id)
    if (held?.complete && !row.complete) continue
    byId.set(row.id, row)
  }
  return { sweptAt: new Date().toISOString(), artists: [...byId.values()] }
}

function loadShard(code) {
  const path = join(OUT_DIR, `${code}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function buildCensus() {
  const shards = existsSync(OUT_DIR)
    ? readdirSync(OUT_DIR).filter((file) => file.endsWith('.json'))
    : []
  const perCountry = []
  const buckets = {
    performer: { artists: 0, candidates: 0 },
    artMusic: { artists: 0, candidates: 0 },
    tradition: { artists: 0, candidates: 0 },
    composer: { artists: 0, candidates: 0 },
  }
  const reasons = { comp: 0, posthumous: 0, gap: 0 }
  /**
   * Exact signal combinations. GAP-ONLY is the number that matters most
   * for Stage 2 scoping: the gap rule rests on MusicBrainz's `begin`,
   * which for a person is BIRTH +15 — a coarse proxy that misfires on
   * anyone whose recording career genuinely started later (the
   * Uruguayan conductor José Serebrier alone raised 72 gap-only
   * candidates, every one of them an honest recording date). Gap
   * corroborated by a comp tag or a posthumous date is a far stronger
   * nomination than gap standing by itself.
   */
  const signalMix = {}
  const displacement = { '40+': 0, '20-39': 0, '10-19': 0, '1-9': 0, '0': 0, unknown: 0 }
  /**
   * The strongest headline figure: candidates dated a decade or more
   * after the artist was FINISHED. No assumption about the material is
   * needed — whatever is on the record, it cannot have been made then.
   */
  let provablyDisplaced = 0
  let artists = 0
  let sweptArtists = 0
  let partial = 0
  let withCandidates = 0
  let candidates = 0

  for (const file of shards) {
    const code = file.replace(/\.json$/, '')
    const shard = JSON.parse(readFileSync(join(OUT_DIR, file), 'utf8'))
    let countryCandidates = 0
    let countryArtists = 0
    for (const row of shard.artists) {
      sweptArtists += 1
      artists += 1
      countryArtists += 1
      if (!row.complete) partial += 1
      const bucket = row.artMusic
        ? 'artMusic'
        : row.tradition
          ? 'tradition'
          : row.composer
            ? 'composer'
            : 'performer'
      buckets[bucket].artists += 1
      buckets[bucket].candidates += row.candidates.length
      if (row.candidates.length > 0) withCandidates += 1
      candidates += row.candidates.length
      countryCandidates += row.candidates.length
      for (const candidate of row.candidates) {
        for (const reason of candidate.reasons) reasons[reason] += 1
        const mix = [...candidate.reasons].sort().join('+')
        signalMix[mix] = (signalMix[mix] ?? 0) + 1
        if (candidate.dispMin !== null && candidate.dispMin >= 10) {
          provablyDisplaced += 1
        }
        const d = candidate.dispMax
        if (d === null) displacement.unknown += 1
        else if (d >= 40) displacement['40+'] += 1
        else if (d >= 20) displacement['20-39'] += 1
        else if (d >= 10) displacement['10-19'] += 1
        else if (d >= 1) displacement['1-9'] += 1
        else displacement['0'] += 1
      }
    }
    perCountry.push({
      code,
      artists: countryArtists,
      candidates: countryCandidates,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    sweptArtists,
    artists,
    partial,
    withCandidates,
    candidates,
    buckets,
    reasons,
    signalMix,
    displacement,
    provablyDisplaced,
    perCountry: perCountry.sort((a, b) => b.candidates - a.candidates),
  }
}

function reportCensus(census, population) {
  const pop = population
    ? [...population.values()].reduce((sum, list) => sum + list.length, 0)
    : null
  console.log('\n════════ RE-DATING CANDIDATE CENSUS (Stage 1) ════════')
  if (pop !== null) console.log(`population in scope : ${pop}`)
  console.log(`artists swept       : ${census.sweptArtists}`)
  console.log(`  partial rows      : ${census.partial} (MB refused pages)`)
  console.log(`artists w/ candidates: ${census.withCandidates}`)
  console.log(`CANDIDATE GROUPS    : ${census.candidates}`)
  console.log('\nby bucket (owner ruling needed on artMusic + composer):')
  for (const [name, data] of Object.entries(census.buckets)) {
    console.log(
      `  ${name.padEnd(10)} artists ${String(data.artists).padStart(6)}  candidates ${String(data.candidates).padStart(7)}`,
    )
  }
  console.log('\nby signal (a candidate may carry more than one):')
  for (const [name, count] of Object.entries(census.reasons)) {
    console.log(`  ${name.padEnd(11)} ${count}`)
  }
  console.log('\nby exact signal combination (gap-only = weakest class):')
  for (const [mix, count] of Object.entries(census.signalMix).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${mix.padEnd(24)} ${count}`)
  }
  console.log(
    `\nPROVABLY displaced 10+ yrs (dated after the artist finished): ${census.provablyDisplaced}`,
  )
  console.log('by MAXIMUM plausible displacement (year − career start):')
  for (const [band, count] of Object.entries(census.displacement)) {
    console.log(`  ${band.padEnd(8)} years ${count}`)
  }
  console.log('\ntop 15 countries by candidate volume:')
  for (const row of census.perCountry.slice(0, 15)) {
    console.log(
      `  ${row.code}  artists ${String(row.artists).padStart(5)}  candidates ${String(row.candidates).padStart(6)}`,
    )
  }
  console.log('══════════════════════════════════════════════════════\n')
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  if (censusOnly) {
    const census = buildCensus()
    writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2) + '\n')
    reportCensus(census, null)
    return
  }

  if (SOURCE === 'dump' && !dumpIndexAvailable()) {
    throw new Error(
      'No local dump index — run scripts/build-mb-dump-index.mjs first.',
    )
  }

  const population = loadPopulation()
  const totalArtists = [...population.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  )
  console.log(
    `${population.size} countries, ${totalArtists} vintage artists in scope (cs<=${VINTAGE_CAREER_START} or end<=${VINTAGE_CAREER_END})`,
  )
  if (SOURCE === 'dump') {
    const meta = dumpSnapshot()
    console.log(
      `source: LOCAL DUMP snapshot ${meta?.snapshot ?? 'unknown'} (${meta?.rows?.toLocaleString() ?? '?'} rows)`,
    )
  } else {
    console.log(`source: LIVE MusicBrainz API at ${DELAY_MS}ms`)
  }

  let done = 0
  let fetched = 0
  let skippedPreRecording = 0

  for (const [code, roster] of population) {
    const existing = loadShard(code)
    const alreadyComplete = new Set(
      (existing?.artists ?? [])
        .filter((row) => row.complete)
        .map((row) => row.id),
    )
    const swept = []

    for (const artist of roster) {
      done += 1
      if (fetched >= artistLimit) break
      if (alreadyComplete.has(artist.id)) continue

      // The one hard skip: no original-era recording can exist.
      if (artist.end !== null && artist.end < RECORDING_ERA_START) {
        skippedPreRecording += 1
        continue
      }

      let result
      if (SOURCE === 'dump') {
        result = dumpGroups(artist.id)
      } else {
        try {
          result = await fetchGroups(artist.id)
        } catch (error) {
          console.warn(`  ${code} ${artist.name}: FAILED — ${error.message}`)
          await sleep(DELAY_MS)
          continue
        }
      }
      swept.push(
        classify(artist, result.groups, result.total, result.complete),
      )
      fetched += 1

      if (fetched % 25 === 0) {
        const merged = foldIntoStored(loadShard(code), swept)
        writeFileSync(
          join(OUT_DIR, `${code}.json`),
          JSON.stringify(merged) + '\n',
        )
        const pct = ((done / totalArtists) * 100).toFixed(1)
        console.log(
          `${pct}% (${done}/${totalArtists}) — ${code}, ${fetched} fetched this run`,
        )
      }
      // The dump is a local read; only the API needs pacing.
      if (SOURCE === 'api') await sleep(DELAY_MS)
    }

    if (swept.length > 0) {
      const merged = foldIntoStored(loadShard(code), swept)
      writeFileSync(
        join(OUT_DIR, `${code}.json`),
        JSON.stringify(merged) + '\n',
      )
      const candidates = swept.reduce(
        (sum, row) => sum + row.candidates.length,
        0,
      )
      console.log(
        `  ${code}: +${swept.length} artists swept, ${candidates} candidates`,
      )
    }
    if (fetched >= artistLimit) {
      console.log(`\n--limit ${artistLimit} reached; stopping.`)
      break
    }
  }

  console.log(
    `\nSweep pass done. ${fetched} artists fetched, ${skippedPreRecording} skipped (died before ${RECORDING_ERA_START}).`,
  )
  const census = buildCensus()
  writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2) + '\n')
  reportCensus(census, population)
}

main().catch((error) => {
  console.error('rg-dating census failed:', error)
  process.exit(1)
})
