/**
 * One-off precompute: MusicBrainz release counts per country per year.
 * Writes data/country-year-counts.json incrementally and is safe to
 * re-run — already-fetched (country, year) pairs are skipped, so an
 * interrupted run resumes where it left off.
 *
 * Usage: node scripts/build-music-data.mjs [startYear] [endYear]
 * Defaults to 1950–2026. Respects MusicBrainz's ~1 req/s rate limit,
 * so a full run takes ~4–5 hours. Run it overnight, commit the output.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const GEOJSON_PATH = 'public/data/countries-110m.geojson'
const OUTPUT_PATH = 'data/country-year-counts.json'
const START_YEAR = Number(process.argv[2] ?? 1950)
const END_YEAR = Number(process.argv[3] ?? 2026)
const DELAY_MS = 1100
const MAX_RETRIES = 5
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'

// Natural Earth marks some territories -99; map the ones MusicBrainz knows.
const ISO_FIXES = { France: 'FR', Norway: 'NO' }

function loadCountryCodes() {
  const geo = JSON.parse(readFileSync(GEOJSON_PATH, 'utf8'))
  const codes = new Set()
  for (const feature of geo.features) {
    const { ISO_A2, ADMIN } = feature.properties
    const code = /^[A-Z]{2}$/.test(ISO_A2) ? ISO_A2 : ISO_FIXES[ADMIN]
    if (code) codes.add(code)
  }
  return [...codes].sort()
}

function loadExisting() {
  if (!existsSync(OUTPUT_PATH)) return {}
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'))
  } catch {
    console.warn('Existing output unreadable; starting fresh')
    return {}
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchCount(country, year) {
  const query = encodeURIComponent(
    `country:${country} AND date:[${year} TO ${year}-12-31]`,
  )
  const url = `https://musicbrainz.org/ws/2/release?query=${query}&limit=1&fmt=json`

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        console.warn(`  rate-limited (${res.status}), backing off ${5 * attempt}s`)
        await sleep(5000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      return body.count ?? 0
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      console.warn(`  ${country}/${year} attempt ${attempt} failed: ${error.message}`)
      await sleep(5000 * attempt)
    }
  }
  throw new Error('unreachable')
}

async function main() {
  mkdirSync('data', { recursive: true })
  const codes = loadCountryCodes()
  const counts = loadExisting()
  const totalPairs = codes.length * (END_YEAR - START_YEAR + 1)
  let done = 0
  let fetched = 0

  console.log(
    `${codes.length} countries × ${END_YEAR - START_YEAR + 1} years (${START_YEAR}–${END_YEAR}) = ${totalPairs} pairs`,
  )

  for (const code of codes) {
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      done++
      if (counts[code]?.[year] !== undefined) continue

      const count = await fetchCount(code, year)
      const updated = { ...(counts[code] ?? {}), [year]: count }
      counts[code] = updated
      fetched++

      if (fetched % 25 === 0) {
        writeFileSync(OUTPUT_PATH, JSON.stringify(counts))
        const pct = ((done / totalPairs) * 100).toFixed(1)
        console.log(`${pct}% (${done}/${totalPairs}) — last: ${code} ${year} = ${count}`)
      }
      await sleep(DELAY_MS)
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(counts))
  console.log(`Done. ${fetched} fetched this run → ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
