/**
 * READ-ONLY measure for the owner's "On this day" question (Oct 10,
 * 2026): how many releases, per country, carry an EXACT release date
 * (day, not just year or month)?
 *
 * Two independent local sources, nothing fetched, nothing written but
 * the report:
 *   · MusicBrainz release groups (data/mb-dump/rg-by-artist): the
 *     group's FIRST release date — the original date an "On this day"
 *     card would print. Country = the credited artist's country (MB
 *     `country`, else the first ISO code up its area chain) — the same
 *     origin sense the panels use. A group credited to artists from two
 *     countries counts once in each; worldwide totals count it once.
 *   · Discogs releases (data/discogs-dump/index/releases-by-country):
 *     every pressing, by the record's own country field. Reissues carry
 *     their own dates, so "originals" also counts, per master, only the
 *     earliest-dated release (masterless releases stand alone).
 *
 * Precision of a date string: day (YYYY-MM-DD, month and day ≠ 00),
 * month (YYYY-MM or YYYY-MM-00), year (YYYY or YYYY-00-00), none.
 * Jan 1 day-dates are counted apart — a common placeholder, so they are
 * not trusted as exact.
 *
 * Resumable: each source pass writes its result into the report when it
 * completes; a rerun skips finished passes (--fresh redoes both).
 *
 * Usage: node scripts/measure-release-date-precision.mjs [--fresh]
 * Output: data/release-date-precision.json
 */
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGunzip } from 'node:zlib'
import { areaChain } from './lib/mbAreaIndex.mjs'

const MB_DIR = process.env.EARCLEF_MB_DUMP_DIR ?? 'data/mb-dump'
const DG_DIR = 'data/discogs-dump/index/releases-by-country'
const OUT_PATH = 'data/release-date-precision.json'
const FRESH = process.argv.includes('--fresh')

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH = /^(\d{4})-(\d{2})(?:-00)?$/
const YEAR = /^(\d{4})(?:-00-00)?$/

/** 'day' | 'jan1' | 'month' | 'year' | 'none' */
export function precisionOf(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'none'
  const date = value.trim()
  const day = DAY.exec(date)
  if (day && day[2] !== '00' && day[3] !== '00') {
    return day[2] === '01' && day[3] === '01' ? 'jan1' : 'day'
  }
  const month = MONTH.exec(date)
  if (month && month[2] !== '00') return 'month'
  if (YEAR.test(date)) return 'year'
  return 'none'
}

const emptyTally = () => ({ total: 0, day: 0, jan1: 0, month: 0, year: 0, none: 0, byDecade: {} })
/** Decade of a dated value ('1970'), or 'undated'. */
const decadeOf = (value, precision) =>
  precision === 'none' ? 'undated' : `${value.trim().slice(0, 3)}0`
/** byDecade[decade] = [total, day-exact] — era matters for "On this day". */
const add = (tally, precision, value) => {
  tally.total++
  tally[precision]++
  const bucket = (tally.byDecade[decadeOf(value, precision)] ??= [0, 0])
  bucket[0]++
  if (precision === 'day') bucket[1]++
}

/**
 * Lines split on '\n' ONLY, streamed (the US file is too big for one
 * string). readline also breaks on a lone '\r', which cut a Discogs
 * record in half on the first run — the index's own reader
 * (lib/discogsDump.mjs) splits on '\n' too.
 */
async function* lines(path) {
  const input = path.endsWith('.gz')
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path)
  input.setEncoding('utf8')
  let pending = ''
  for await (const chunk of input) {
    const parts = (pending + chunk).split('\n')
    pending = parts.pop()
    yield* parts
  }
  if (pending) yield pending
}

function loadReport() {
  if (FRESH || !existsSync(OUT_PATH)) return {}
  try {
    return JSON.parse(readFileSync(OUT_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveReport(report) {
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 1))
}

/** Artist MBID → ISO country, from the artist-names index. */
async function artistCountries() {
  const dir = join(MB_DIR, 'artist-names')
  const byArtist = new Map()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()) {
    for await (const line of lines(join(dir, file))) {
      if (!line) continue
      const record = JSON.parse(line).r
      if (!record?.id || byArtist.has(record.id)) continue
      let country = record.country ?? null
      if (!country && record.area?.id) {
        const iso = areaChain(record.area.id).find((area) => area.isoCodes.length > 0)
        country = iso ? iso.isoCodes[0].slice(0, 2) : null
      }
      byArtist.set(record.id, country)
    }
  }
  return byArtist
}

async function mbPass() {
  const countries = await artistCountries()
  console.log(`MB: ${countries.size.toLocaleString()} artists indexed`)
  const dir = join(MB_DIR, 'rg-by-artist')
  /** rg id → { date, countries:Set } — a group can be credited to several artists. */
  const groups = new Map()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()) {
    for await (const line of lines(join(dir, file))) {
      if (!line) continue
      const row = JSON.parse(line)
      let group = groups.get(row.i)
      if (!group) {
        group = { date: row.d ?? '', precision: precisionOf(row.d), countries: new Set() }
        groups.set(row.i, group)
      }
      group.countries.add(countries.get(row.a) ?? 'unknown')
    }
  }
  const worldwide = emptyTally()
  const byCountry = {}
  for (const group of groups.values()) {
    add(worldwide, group.precision, group.date)
    for (const country of group.countries) add((byCountry[country] ??= emptyTally()), group.precision, group.date)
  }
  console.log(`MB: ${groups.size.toLocaleString()} release groups`)
  return { source: 'MusicBrainz release groups (first release date) by artist country', worldwide, byCountry }
}

/** Earlier of two date strings; a dated value always beats an undated one. */
const earlier = (a, b) => (!a ? b : !b ? a : a <= b ? a : b)

async function discogsPass() {
  const worldwide = emptyTally()
  const byCountry = {}
  /** master id → { date, country } of its earliest-dated release. */
  const masters = new Map()
  const originalsWorldwide = emptyTally()
  const originalsByCountry = {}
  const files = readdirSync(DG_DIR).filter((name) => name.endsWith('.jsonl.gz')).sort()
  for (const [index, file] of files.entries()) {
    for await (const line of lines(join(DG_DIR, file))) {
      if (!line) continue
      const row = JSON.parse(line)
      const country = row.c || '(no country)'
      const precision = precisionOf(row.r)
      add(worldwide, precision, row.r)
      add((byCountry[country] ??= emptyTally()), precision, row.r)
      if (!row.m) {
        add(originalsWorldwide, precision, row.r)
        add((originalsByCountry[country] ??= emptyTally()), precision, row.r)
        continue
      }
      const seen = masters.get(row.m)
      const dated = precision === 'none' ? null : row.r.trim()
      if (!seen || earlier(seen.date, dated) !== seen.date) {
        masters.set(row.m, { date: dated, country })
      }
    }
    if ((index + 1) % 50 === 0) console.log(`  Discogs: ${index + 1}/${files.length} country files`)
  }
  for (const { date, country } of masters.values()) {
    const precision = precisionOf(date)
    add(originalsWorldwide, precision, date)
    add((originalsByCountry[country] ??= emptyTally()), precision, date)
  }
  return {
    source: 'Discogs releases by the record\'s own country field',
    worldwide,
    byCountry,
    originals: {
      note: 'per master, only its earliest-dated release (its country); masterless releases stand alone',
      worldwide: originalsWorldwide,
      byCountry: originalsByCountry,
    },
  }
}

async function main() {
  const report = loadReport()
  report.measuredAt ??= new Date().toISOString()
  report.precision = 'day = YYYY-MM-DD with month and day set; jan1 = day-dates on Jan 1, counted apart as likely placeholders'
  if (!report.musicbrainz) {
    report.musicbrainz = await mbPass()
    saveReport(report)
  } else console.log('MB pass already in report — skipped')
  if (!report.discogs) {
    report.discogs = await discogsPass()
    saveReport(report)
  } else console.log('Discogs pass already in report — skipped')
  console.log(`Done → ${OUT_PATH}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
