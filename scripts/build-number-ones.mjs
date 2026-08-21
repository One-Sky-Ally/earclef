/**
 * #1 hits ingest — Billboard Hot 100 (US) + UK Official Singles Chart.
 *
 * Authority is the chart itself (Gate v3 Tier 1: Billboard / OCC);
 * transport is Wikipedia's number-ones list pages via the sanctioned
 * MediaWiki API (owner ruling Aug 20, 2026 — facts sourced on every
 * page to the chart publisher; direct bulk extraction from
 * billboard.com / officialcharts.com is prohibited by their terms).
 * Manual browser spot-checks against the official archives run before
 * the section ships — this script only compiles.
 *
 * US: one page per year, 1958 (Hot 100 launch, Aug) → present.
 *     Weekly issue-date rows; a song's `weeks` = weeks at #1 within
 *     that year (reigns crossing Dec 31 appear in both years, honest
 *     per-year counts). Pre-1958 Billboard predecessors are OUT
 *     (owner ruling F1-3).
 * UK: one page per decade, 1950s → present (OCC canon: NME 1952–60,
 *     Record Retailer 1960–69). One row per reign; assigned to the
 *     year it reached #1; `weeks` = the reign's total weeks.
 *
 * Usage: node scripts/build-number-ones.mjs [--from 1958] [--to 2026]
 * Output: lib/hits/number-ones-us.json, lib/hits/number-ones-uk.json
 *         (committed; server-only imports — never in the client bundle)
 * Cache:  data/wiki-cache/ (gitignored) so parser iterations refetch nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const API = 'https://en.wikipedia.org/w/api.php'
const CACHE_DIR = 'data/wiki-cache'
const OUT_DIR = 'lib/hits'
const DELAY_MS = 1500

const NOW_YEAR = new Date().getFullYear()
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? Number(process.argv[i + 1]) : fallback
}
const FROM = argOf('--from', 1952)
const TO = argOf('--to', NOW_YEAR)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
}

/** Tag-strip + footnote-marker strip ("[nb 2]", "[a]") + whitespace. */
function cellText(cellHtml) {
  const text = decodeEntities(cellHtml.replace(/<[^>]+>/g, ''))
  return text
    .replace(/\[[^\]]{0,12}\]/g, '')
    .replace(/[†‡♦]/g, '') // best-seller/annotation daggers, not titles
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchPage(title) {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = `${CACHE_DIR}/${title.replace(/[^a-z0-9]+/gi, '-')}.json`
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'))
  }
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${title}: HTTP ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`${title}: ${body.error.info}`)
  const page = { title: body.parse.title, html: body.parse.text }
  writeFileSync(cachePath, JSON.stringify(page))
  await sleep(DELAY_MS)
  return page
}

/**
 * Expand a wikitable into a rowspan/colspan-honoring grid of
 * {text, isNewCell} cells, so every logical row reads the same
 * columns regardless of how reigns are drawn.
 */
function tableGrid(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((m) => m[1])
  const grid = []
  const carry = [] // carry[col] = {text, remaining}
  for (const rowHtml of rows) {
    const cells = [...rowHtml.matchAll(/<(t[dh])([^>]*)>(.*?)<\/t[dh]>/gs)]
    if (cells.length === 0) continue
    const out = []
    let col = 0
    const takeCarried = () => {
      while (carry[col] && carry[col].remaining > 0) {
        carry[col].remaining--
        out[col] = { text: carry[col].text, isNewCell: false }
        col++
      }
    }
    for (const [, , attrs, inner] of cells) {
      takeCarried()
      const rowspan = Number(/rowspan="?(\d+)/.exec(attrs)?.[1] ?? 1)
      const colspan = Number(/colspan="?(\d+)/.exec(attrs)?.[1] ?? 1)
      const text = cellText(inner)
      for (let span = 0; span < colspan; span++) {
        out[col] = { text, isNewCell: true }
        if (rowspan > 1) carry[col] = { text, remaining: rowspan - 1 }
        col++
      }
    }
    takeCarried()
    grid.push(out)
  }
  return grid
}

/**
 * The first wikitable satisfying every marker group (a group is a set
 * of alternatives — column naming drifts across pages, and some pages
 * carry extra tables sharing one column name, like 1958's pre-Hot-100
 * component charts).
 */
function mainTable(html, markerGroups) {
  const tables = html.match(/<table class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/g) ?? []
  const found = tables.filter((table) =>
    markerGroups.every((group) => group.some((marker) => table.includes(marker))),
  )
  if (found.length === 0) {
    throw new Error(`no wikitable matching ${JSON.stringify(markerGroups)}`)
  }
  return found[0]
}

/** Header-row indices for the named columns (throws when absent). */
function headerIndices(grid, wanted) {
  const header = grid.find((row) =>
    wanted.every((names) =>
      row.some((cell) => names.some((n) => cell?.text.toLowerCase().startsWith(n))),
    ),
  )
  if (!header) throw new Error(`header row not found (${wanted.flat().join('/')})`)
  return {
    header,
    indexOf: (names) =>
      header.findIndex((cell) =>
        names.some((n) => cell?.text.toLowerCase().startsWith(n)),
      ),
  }
}

function isoDate(year, monthName, day) {
  const month = MONTHS[monthName.toLowerCase()]
  if (!month) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** US year page → entries for that year (weekly rows, grouped by reign). */
function parseUsYear(html, year) {
  const grid = tableGrid(mainTable(html, [['Issue date'], ['Artist']]))
  const { header, indexOf } = headerIndices(grid, [
    ['issue date'],
    ['title', 'song'],
    ['artist'],
  ])
  const dateCol = indexOf(['issue date'])
  const titleCol = indexOf(['title', 'song'])
  const artistCol = indexOf(['artist'])
  const entries = []
  let current = null
  for (const row of grid.slice(grid.indexOf(header) + 1)) {
    const date = row[dateCol]?.text ?? ''
    const dateMatch = /^([A-Za-z]+) (\d{1,2})$/.exec(date)
    if (!dateMatch) continue // navigation/footer rows
    const title = row[titleCol]?.text
    const artist = row[artistCol]?.text
    if (!title || !artist) continue
    const isNew = row[titleCol].isNewCell
    if (isNew || !current || current.title !== title || current.artist !== artist) {
      current = {
        title,
        artist,
        first: isoDate(year, dateMatch[1], dateMatch[2]),
        weeks: 1,
      }
      entries.push(current)
    } else {
      current.weeks++
    }
  }
  return entries
}

/** UK decade page → reign rows bucketed by the year each reached #1. */
function parseUkDecade(html) {
  // Column naming drifts across decades: "Week ending date" (1970s+)
  // vs "Week starting date" (1950s) — both are the reign's first week.
  const grid = tableGrid(
    mainTable(html, [['Week ending', 'Week starting'], ['Artist']]),
  )
  const { header, indexOf } = headerIndices(grid, [
    ['artist'],
    ['single'],
    ['week ending', 'week starting'],
    ['weeks at'],
  ])
  const artistCol = indexOf(['artist'])
  const titleCol = indexOf(['single'])
  const dateCol = indexOf(['week ending', 'week starting'])
  const weeksCol = indexOf(['weeks at'])
  const byYear = {}
  for (const row of grid.slice(grid.indexOf(header) + 1)) {
    const date = row[dateCol]?.text ?? ''
    const dateMatch = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(date)
    if (!dateMatch) continue
    const title = (row[titleCol]?.text ?? '').replace(/^"|"$/g, '')
    const artist = row[artistCol]?.text
    const weeks = Number(row[weeksCol]?.text)
    if (!title || !artist || !Number.isFinite(weeks)) continue
    const year = Number(dateMatch[3])
    const first = isoDate(year, dateMatch[2], dateMatch[1])
    byYear[year] ??= []
    // A returning reign can repeat title+artist within a year — keep
    // both rows honest rather than merging what the chart lists apart.
    byYear[year].push({ title, artist, first, weeks })
  }
  return byYear
}

async function buildUs() {
  const from = Math.max(FROM, 1958)
  const byYear = {}
  for (let year = from; year <= TO; year++) {
    const title = `List of Billboard Hot 100 number ones of ${year}`
    const page = await fetchPage(title)
    const entries = parseUsYear(page.html, year).map((entry) => ({
      ...entry,
      title: entry.title.replace(/^"|"$/g, ''),
    }))
    if (entries.length === 0) throw new Error(`${title}: parsed 0 entries`)
    const weekSum = entries.reduce((sum, entry) => sum + entry.weeks, 0)
    // 1958 is a partial year: the Hot 100 launched Aug 4 (~22 issues).
    const [minWeeks, maxWeeks] = year === 1958 ? [20, 24] : [48, 56]
    if (year < NOW_YEAR && (weekSum < minWeeks || weekSum > maxWeeks)) {
      throw new Error(`${title}: ${weekSum} chart weeks — parser or page anomaly`)
    }
    byYear[year] = { entries, sourcePage: page.title }
    console.log(`US ${year}: ${entries.length} #1s, ${weekSum} weeks`)
  }
  return byYear
}

async function buildUk() {
  const byYear = {}
  const decades = []
  for (let decade = 1950; decade <= TO; decade += 10) decades.push(decade)
  for (const decade of decades) {
    const title = `List of UK Singles Chart number ones of the ${decade}s`
    const page = await fetchPage(title)
    const parsed = parseUkDecade(page.html)
    const years = Object.keys(parsed).map(Number)
    if (years.length === 0) throw new Error(`${title}: parsed 0 entries`)
    for (const year of years) {
      // Decade pages start with the reign in progress on Jan 1 (its
      // reach date is in the prior decade) — the prior decade's page
      // already carries that reign, so keep first-seen only.
      byYear[year] ??= { entries: [], sourcePage: page.title }
      if (byYear[year].entries.length === 0) {
        byYear[year].entries = parsed[year]
      }
    }
    console.log(
      `UK ${decade}s: years ${Math.min(...years)}–${Math.max(...years)}, ` +
        `${Object.values(parsed).flat().length} reigns`,
    )
  }
  for (const year of Object.keys(byYear).map(Number)) {
    if (year < FROM || year > TO) delete byYear[year]
  }
  // The chart began 14 Nov 1952 — every year since must have reigns.
  for (let year = Math.max(FROM, 1952); year <= Math.min(TO, NOW_YEAR); year++) {
    if (!byYear[year] || byYear[year].entries.length === 0) {
      throw new Error(`UK ${year}: no reigns parsed — page or parser anomaly`)
    }
  }
  return byYear
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const us = await buildUs()
  const uk = await buildUk()
  const stamp = new Date().toISOString().slice(0, 10)
  writeFileSync(
    `${OUT_DIR}/number-ones-us.json`,
    JSON.stringify({
      chart: 'billboard-hot-100',
      chartName: 'Billboard Hot 100',
      attribution: 'Source: Billboard Hot 100 (compiled via Wikipedia)',
      weeksSemantics: 'weeks at #1 within the listed year',
      generatedAt: stamp,
      years: us,
    }),
  )
  writeFileSync(
    `${OUT_DIR}/number-ones-uk.json`,
    JSON.stringify({
      chart: 'uk-singles-chart',
      chartName: 'Official Singles Chart',
      attribution: 'Source: Official Singles Chart (compiled via Wikipedia)',
      weeksSemantics: 'total weeks of the reign that began in the listed year',
      generatedAt: stamp,
      years: uk,
    }),
  )
  const usCount = Object.values(us).reduce((n, y) => n + y.entries.length, 0)
  const ukCount = Object.values(uk).reduce((n, y) => n + y.entries.length, 0)
  console.log(`Done → ${OUT_DIR}: US ${usCount} entries, UK ${ukCount} entries`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
