/**
 * The record of how many artists each country has — the evidence
 * behind an owner ruling, not an input to any running code.
 *
 * THE QUESTION IT WAS RUN TO ANSWER (Aug 29, 2026). The non-globe
 * fallback lists every polygon in countries-110m.geojson, so it offers
 * Antarctica, the Falklands and the French Southern Lands as places to
 * browse for music, and the ask was to drop places with no artists.
 * The obvious filter — public/data/country-year-counts.json — is
 * RELEASE counts from a MusicBrainz search query and is not usable: it
 * claims 7,618 releases for Antarctica and 27,827 for the Falklands,
 * because digital distributions enumerate every territory on earth.
 * Standing lesson 4 exactly — the query layer lies.
 *
 * WHAT THIS MEASURES INSTEAD. Artists whose OWN MusicBrainz record
 * carries `country: XX`. The search index only FINDS candidates; each
 * one is then checked against its own country field, and only
 * self-confirming records count. `verified` is a floor capped at
 * PAGE_SIZE, never a guess, and `countClaimed` sits beside it so the
 * two can disagree in public. Below the cap the two agree, which is
 * what makes the bottom of the distribution exact — and the bottom was
 * the whole question.
 *
 * THE ANSWER, AND THE RULING. **No country has zero artists** — all
 * 175 coded features have at least one, the lowest being the French
 * Southern Lands with exactly one. A count threshold cannot do the job
 * either: Antarctica's 18 outrank Vanuatu (7), Bhutan (14) and Western
 * Sahara (15), so any cut that removes Antarctica removes them too.
 * Owner ruling: the artist's claim wins. Antarctica's 18 are people
 * who filed themselves there, and removing them would be the site
 * overruling claims the owner chose to honour. Filter only places with
 * zero artists — and since none exist, the list is left alone.
 *
 * Re-run this if that ever needs re-checking; nothing reads its output.
 *
 * Usage: node scripts/build-country-artist-counts.mjs
 * ~180 requests at MusicBrainz's ~1 req/s courtesy limit. Safe to
 * re-run: recorded codes are skipped, so an interrupted run resumes,
 * and MusicBrainz answering "busy" (which it does often, sometimes
 * with HTTP 200 and an error body) leaves gaps a second run fills.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const GEOJSON_PATH = 'public/data/countries-110m.geojson'
const OUTPUT_PATH = 'data/country-artist-counts.json'
const DELAY_MS = 1100
const MAX_RETRIES = 5
/** One page is plenty: the question is "any artists", not "how many". */
const PAGE_SIZE = 25
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

// Natural Earth marks some territories -99; map the ones MB knows.
const ISO_FIXES = { France: 'FR', Norway: 'NO' }

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

function loadExisting() {
  if (!existsSync(OUTPUT_PATH)) return {}
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')).countries ?? {}
  } catch {
    console.warn('Existing output unreadable; starting fresh')
    return {}
  }
}

async function fetchArtists(code) {
  const query = encodeURIComponent(`country:${code}`)
  const url = `https://musicbrainz.org/ws/2/artist?query=${query}&limit=${PAGE_SIZE}&fmt=json`

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
      // enough that trusting the status code alone loses codes silently.
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
  throw new Error(`${code}: exhausted retries`)
}

async function main() {
  const countries = loadCountries()
  const results = loadExisting()
  console.log(
    `${countries.length} codes in the geojson; ${Object.keys(results).length} already recorded`,
  )

  for (const [code, name] of countries) {
    if (results[code]) continue
    let body
    try {
      body = await fetchArtists(code)
    } catch (error) {
      console.warn(`  ${code} (${name}): FAILED — ${error.message}`)
      await sleep(DELAY_MS)
      continue
    }
    const returned = body.artists ?? []
    // Per-record confirmation: the search found them, their own record
    // has to agree before they count.
    const confirmed = returned.filter((artist) => artist.country === code)
    results[code] = {
      name,
      countClaimed: body.count ?? 0,
      inspected: returned.length,
      verified: confirmed.length,
      // Names make the number auditable by eye — the whole point is
      // that someone can see WHAT an "artist from Antarctica" is.
      sample: confirmed.slice(0, 5).map((artist) => artist.name),
    }
    writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), method: 'musicbrainz artist country field, per-record confirmed', countries: results },
        null,
        2,
      ) + '\n',
    )
    console.log(
      `  ${code} (${name}): claimed ${results[code].countClaimed}, confirmed ${confirmed.length}/${returned.length}`,
    )
    await sleep(DELAY_MS)
  }

  const recorded = Object.keys(results).length
  console.log(`\nDONE — ${recorded}/${countries.length} codes recorded -> ${OUTPUT_PATH}`)
  const missing = countries.filter(([code]) => !results[code]).map(([code]) => code)
  if (missing.length > 0) console.log(`MISSING (re-run to fill): ${missing.join(', ')}`)
}

main().catch((error) => {
  console.error('sweep failed:', error)
  process.exit(1)
})
