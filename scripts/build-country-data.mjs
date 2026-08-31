/**
 * Country-level precompute: the panel dataset for every country, so a
 * country click answers from committed data instead of MusicBrainz.
 *
 * THE PATTERN IS NOT NEW — it is exactly what build-state-data.mjs
 * already does for US states and UK nations, and the reason those
 * panels have never needed MusicBrainz at runtime. Nothing is stored
 * per combo: one compact record per artist (id, name, career start,
 * end, tag weight, tags) and the panel for any year span and any genre
 * lens is DERIVED at read time. That is why 2.9 MB covers 51 regions ×
 * 127 years × 20 lenses, and why 175 countries do not explode into the
 * 22,225 country×year combinations a per-panel cache would need.
 *
 * CAP: 2,000 artists per country (owner ruling, Aug 2026). The
 * distribution is brutally skewed — the median country has 347 artists
 * and the largest has 226,213 — so 2,000 stores 125 of 175 countries
 * COMPLETE for ~17.5 MB. It is also DEEPER than the live route, which
 * only ever fetches ORIGIN_PAGE_SIZE × ORIGIN_PAGES = 200 artists and
 * ranks within those. This is an upgrade, not a degraded copy.
 *
 * ROSTER COMPOSITION, stated as it actually behaves. The sweep stops
 * paging AT the cap, so for every country records ≤ 2,000 and
 * composeRoster's selection never binds — the stored roster is simply
 * MusicBrainz's first 2,000 confirmed rows, which its own ordering
 * skews toward earliest-registered (and so toward the famous). That
 * ordering turns out to spread eras well on its own: Argentina, capped
 * at 1,986 of 9,327, still carries 1900:7 1910:23 1920:43 1930:59
 * through 2020:16. The top-per-decade pass is kept because it is what
 * makes the cap safe the day fetch depth and cap depth differ — deepen
 * the paging and it starts doing real work — but today it is a guard,
 * not a filter, and the comment should not imply otherwise.
 *
 * Resumable: each country writes its own file, and finished countries
 * are skipped. Re-run to continue after a stop or a MusicBrainz wobble.
 *
 * Usage:
 *   node scripts/build-country-data.mjs                  # all, resume
 *   node scripts/build-country-data.mjs --only EG,JM,PA  # named codes
 *   node scripts/build-country-data.mjs --refresh        # ignore existing
 *   node scripts/build-country-data.mjs --delay 2500     # gentler pace
 *
 * Outputs: lib/explore/country-artists/<CODE>.json (one per country,
 * so a refresh diffs surgically instead of rewriting 17.5 MB), plus
 * an index the serving layer reads to know what exists.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const GEOJSON_PATH = 'public/data/countries-110m.geojson'
const OUT_DIR = 'lib/explore/country-artists'
const INDEX_PATH = 'lib/explore/country-artists-index.json'
/**
 * MusicBrainz's courtesy limit is ~1 req/s, but a long session of
 * sweeps earns sustained throttling, and then the 1.1s pace fails more
 * pages than it saves — the first full run lost 31 countries that way,
 * and a second left the US, Canada, Taiwan and Ukraine at zero rows.
 * `--delay 2500` finishes a stubborn tail faster than retrying at 1.1s.
 */
const DELAY_MS = (() => {
  const flag = process.argv.indexOf('--delay')
  const value = flag !== -1 ? Number(process.argv[flag + 1]) : NaN
  return Number.isFinite(value) && value >= 1100 ? value : 1100
})()
const MAX_RETRIES = 5
const PAGE_SIZE = 100
/** Owner ruling, Aug 2026. */
const CAP_PER_COUNTRY = 2000
/**
 * Consecutive-ish page failures tolerated before abandoning a country
 * for this pass. Skipping past a refusal is right; grinding through
 * twenty of them when MusicBrainz is simply down is not.
 */
const MAX_PAGE_FAILURES = 6
/** Guaranteed slots per emergence decade before weight fills the rest. */
const KEEP_TOP_PER_DECADE = 60
const KEEP_TAGS = 6
/** Live-route parity: a person's career starts ~15y after birth. */
const PERSON_CAREER_OFFSET_YEARS = 15
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

// Natural Earth marks some territories -99; map the ones MB knows.
const ISO_FIXES = { France: 'FR', Norway: 'NO' }

const onlyArg = process.argv.indexOf('--only')
const onlyCodes =
  onlyArg !== -1 ? (process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean) : null
const refresh = process.argv.includes('--refresh')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadCountries() {
  const geo = JSON.parse(readFileSync(GEOJSON_PATH, 'utf8'))
  const byCode = new Map()
  for (const feature of geo.features) {
    const { ISO_A2, ADMIN } = feature.properties
    const code = /^[A-Z]{2}$/.test(ISO_A2) ? ISO_A2 : ISO_FIXES[ADMIN]
    if (code && !byCode.has(code)) byCode.set(code, ADMIN)
  }
  return [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

async function mbJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        await sleep(5000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      // MusicBrainz answers "busy" with 200 and an error body often
      // enough that trusting the status alone loses whole countries.
      if (body.error || body.count === undefined) {
        await sleep(5000 * attempt)
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

/** The stored record — byte-for-byte the shape stateData.ts serves. */
function toRecord(artist) {
  const beginYear = Number(artist['life-span']?.begin?.slice(0, 4))
  const endYear = Number(artist['life-span']?.end?.slice(0, 4))
  const voted = (artist.tags ?? []).filter((tag) => (tag.count ?? 0) > 0)
  return {
    id: artist.id,
    name: artist.name,
    cs: Number.isFinite(beginYear)
      ? beginYear + (artist.type === 'Person' ? PERSON_CAREER_OFFSET_YEARS : 0)
      : null,
    end: Number.isFinite(endYear) ? endYear : null,
    w: voted.reduce((sum, tag) => sum + (tag.count ?? 0), 0),
    t: voted
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, KEEP_TAGS)
      .flatMap((tag) => (tag.name ? [tag.name] : [])),
  }
}

/**
 * Top per decade first, then the highest-weight remainder.
 *
 * A NO-OP AT THE CURRENT SETTINGS — the sweep stops paging at the cap,
 * so there is never a surplus to select from. It exists so that
 * deepening the fetch cannot silently fill the whole cap with the
 * streaming era and leave the 1930s empty in precisely the countries
 * big enough to be capped.
 */
function composeRoster(records) {
  const byWeight = [...records].sort((a, b) => b.w - a.w)
  const chosen = new Map()
  const perDecade = new Map()
  for (const record of byWeight) {
    if (record.cs === null) continue
    const decade = Math.floor(record.cs / 10) * 10
    const taken = perDecade.get(decade) ?? 0
    if (taken >= KEEP_TOP_PER_DECADE) continue
    perDecade.set(decade, taken + 1)
    chosen.set(record.id, record)
  }
  for (const record of byWeight) {
    if (chosen.size >= CAP_PER_COUNTRY) break
    chosen.set(record.id, record)
  }
  return [...chosen.values()]
    .sort((a, b) => b.w - a.w)
    .slice(0, CAP_PER_COUNTRY)
}

function histogram(records, key) {
  const out = {}
  for (const record of records) {
    const year = record[key]
    if (year === null) continue
    out[year] = (out[year] ?? 0) + 1
  }
  return out
}

async function sweepCountry(code, name) {
  const query = encodeURIComponent(`country:${code}`)
  const seen = new Map()
  let claimed = 0
  let complete = true
  let failures = 0
  for (let offset = 0; offset < CAP_PER_COUNTRY; offset += PAGE_SIZE) {
    let body
    try {
      body = await mbJson(
        `https://musicbrainz.org/ws/2/artist?query=${query}&limit=${PAGE_SIZE}&offset=${offset}&fmt=json`,
      )
    } catch {
      /*
       * SKIP THE PAGE, KEEP GOING. Two earlier versions were worse.
       * The first threw away the whole country when one page exhausted
       * its retries — 31 of 175 were lost that way, the US and Great
       * Britain among them. The second kept what it had but STOPPED at
       * the failed page, so every later pass re-trod offsets 0..N and
       * died at the same place: the US sat at 1,199 rows across two
       * full passes, gaining nothing.
       *
       * A probe settled which it was — offsets 1500 and 1900 of
       * `country:US` answer fine while 1100 and 1200 return 503, so
       * these are transient refusals, not a deep-paging limit. Skipping
       * past one lets a pass reach ground it has never covered, and the
       * merge means whatever it finds is kept.
       */
      complete = false
      failures += 1
      if (failures >= MAX_PAGE_FAILURES) break
      await sleep(DELAY_MS)
      continue
    }
    claimed = body.count ?? 0
    for (const artist of body.artists ?? []) {
      // Per-record confirmation: the index found them, their own record
      // has to agree before this country stores them.
      if (artist.country !== code || seen.has(artist.id)) continue
      seen.set(artist.id, toRecord(artist))
    }
    if (offset + PAGE_SIZE >= claimed) break
    await sleep(DELAY_MS)
  }
  return { records: [...seen.values()], claimed, complete }
}

/**
 * Fold a sweep into whatever is already stored.
 *
 * MERGE, NEVER REPLACE. The first version of resume overwrote the
 * file, so a re-sweep that fared WORSE than the run before threw away
 * good rows — Slovakia went from 1,655 artists to 0 that way, because
 * MusicBrainz happened to be refusing when its turn came round again.
 * Every pass must be monotonic: rows only accumulate, and `complete`
 * only becomes true when a run actually reached the end.
 */
function foldIntoStored(name, existing, swept) {
  const byId = new Map()
  for (const record of existing?.artists ?? []) byId.set(record.id, record)
  for (const record of swept.records) byId.set(record.id, record)
  const records = [...byId.values()]
  const roster = composeRoster(records)
  const claimed = Math.max(swept.claimed, existing?.total ?? 0)
  return {
    name,
    /**
     * Monotonic like the rows: a country that finished once stays
     * finished. The merge keeps every earlier row, so a later run that
     * MusicBrainz refuses cannot make the file less complete than it
     * already was — only the row count can move, and only upward.
     */
    complete: swept.complete || existing?.complete === true,
    /** MusicBrainz's own total — the truth, even when we store less. */
    total: claimed,
    /** Artists fetched before the cap; histograms cover exactly these. */
    inspected: records.length,
    /**
     * True when the CAP kept us from seeing the whole country — tested
     * against MusicBrainz's claimed total, not against how many rows
     * survived confirmation.
     *
     * Two wrong versions were shipped and caught before this one.
     * `claimed > records.length` marked Egypt truncated: it claims 633
     * and confirms 615, but those 18 are per-record rejections, which
     * is the point of confirming, not the cap biting. Then
     * `records.length >= CAP` marked Argentina UNtruncated: it claims
     * 9,327, we paged 2,000 and confirmed 1,986 — so the count never
     * reached the cap even though the cap is exactly why we stopped.
     * Only the claimed total knows whether we saw everything.
     */
    truncated: claimed > CAP_PER_COUNTRY,
    undated: records.filter((record) => record.cs === null).length,
    begins: histogram(records, 'cs'),
    ends: histogram(records, 'end'),
    artists: roster,
  }
}

function writeIndex() {
  const codes = readdirSync(OUT_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort()
  writeFileSync(
    INDEX_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), codes },
      null,
      2,
    ) + '\n',
  )
  return codes.length
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const countries = loadCountries().filter(
    ([code]) => !onlyCodes || onlyCodes.includes(code),
  )
  console.log(`${countries.length} countries to sweep (cap ${CAP_PER_COUNTRY})`)

  for (const [code, name] of countries) {
    const path = join(OUT_DIR, `${code}.json`)
    if (!refresh && existsSync(path)) {
      try {
        // Skip only countries that finished. An incomplete file is a
        // placeholder, not an answer.
        if (JSON.parse(readFileSync(path, 'utf8')).complete !== false) continue
      } catch {
        // Unreadable file: re-sweep it.
      }
    }
    try {
      const existing = existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf8'))
        : null
      const swept = await sweepCountry(code, name)
      const stored = foldIntoStored(name, existing, swept)
      writeFileSync(path, JSON.stringify(stored) + '\n')
      const gained = stored.artists.length - (existing?.artists.length ?? 0)
      console.log(
        `  ${code} (${name}): ${stored.artists.length} stored${gained > 0 ? ` (+${gained})` : ''} of MB's ${stored.total}${stored.complete ? '' : ' [INCOMPLETE]'}${stored.truncated ? ' [capped]' : ''}`,
      )
    } catch (error) {
      console.warn(`  ${code} (${name}): FAILED — ${error.message}`)
    }
    await sleep(DELAY_MS)
  }

  const count = writeIndex()
  console.log(`\nDONE — ${count} countries in ${OUT_DIR}, index written`)
  const missing = countries.filter(
    ([code]) => !existsSync(join(OUT_DIR, `${code}.json`)),
  )
  if (missing.length > 0) {
    console.log(`MISSING (re-run to fill): ${missing.map(([c]) => c).join(', ')}`)
  }
}

main().catch((error) => {
  console.error('country precompute failed:', error)
  process.exit(1)
})
