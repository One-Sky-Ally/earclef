/**
 * Genre-lens precompute: where each genre's artists EMERGED, by country
 * and decade. For every curated genre, page through all dated
 * MusicBrainz artists carrying the tag and bucket them locally —
 * Σ pages ≈ artists/100, not genres × countries × decades.
 *
 * Emergence follows the panel's honesty rule: groups start at their
 * formation date; people at birth + 15 (MB "begin" is the birth date).
 *
 * RESUMABLE: completed genres are recorded in the output; re-running
 * skips them. Run detached + clamshell-safe:
 *   nohup caffeinate -is node scripts/build-genre-data.mjs \
 *     >> data/genre-precompute.log 2>&1 &
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OUT_PATH = join(process.cwd(), 'public', 'data', 'genre-artist-emergence.json')
const USER_AGENT =
  'EarClefGenrePrecompute/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'

const GENRES = [
  'jazz',
  'blues',
  'folk',
  'reggae',
  'punk',
  'metal',
  'hip hop',
  'techno',
  'bossa nova',
  'k-pop',
]

const PAGE_SIZE = 100
const MAX_ARTISTS_PER_GENRE = 25000
const DELAY_MS = 1100
const PERSON_CAREER_OFFSET_YEARS = 15
const DECADE_MIN = 1900
const DECADE_MAX = 2020

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function mbJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        const backoff = 3000 * attempt
        console.log(`  rate-limited, backing off ${backoff}ms`)
        await sleep(backoff)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      if (attempt === 4) throw error
      console.log(`  fetch error (${error.message}), retry ${attempt}`)
      await sleep(3000 * attempt)
    }
  }
}

function loadExisting() {
  try {
    return JSON.parse(readFileSync(OUT_PATH, 'utf8'))
  } catch {
    return {
      meta: {
        method:
          'MusicBrainz artists per genre tag, bucketed by origin country and emergence decade (group formation; person birth + 15). One count per artist per genre.',
        personCareerOffsetYears: PERSON_CAREER_OFFSET_YEARS,
        completed: [],
      },
      genres: {},
    }
  }
}

function emergenceDecade(artist) {
  const begin = Number(artist['life-span']?.begin?.slice(0, 4))
  if (!Number.isFinite(begin)) return null
  const start =
    artist.type === 'Person' ? begin + PERSON_CAREER_OFFSET_YEARS : begin
  if (start < DECADE_MIN || start > DECADE_MAX + 9) return null
  return Math.floor(start / 10) * 10
}

async function buildGenre(genre) {
  const query = encodeURIComponent(`tag:"${genre}" AND begin:[1900 TO 2026]`)
  const counts = {}
  const seen = new Set()
  let total = Infinity
  let kept = 0

  for (let offset = 0; offset < Math.min(total, MAX_ARTISTS_PER_GENRE); offset += PAGE_SIZE) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${query}&limit=${PAGE_SIZE}&offset=${offset}&fmt=json`,
    )
    total = body.count ?? 0
    for (const artist of body.artists ?? []) {
      if (seen.has(artist.id)) continue
      seen.add(artist.id)
      const country = artist.country
      if (!country || !/^[A-Z]{2}$/.test(country)) continue
      const decade = emergenceDecade(artist)
      if (decade === null) continue
      counts[country] ??= {}
      counts[country][decade] = (counts[country][decade] ?? 0) + 1
      kept++
    }
    if (offset % 1000 === 0) {
      console.log(
        `  ${genre}: ${Math.min(offset + PAGE_SIZE, total)}/${total} scanned, ${kept} placed`,
      )
    }
    await sleep(DELAY_MS)
  }
  if (total > MAX_ARTISTS_PER_GENRE) {
    console.log(
      `  NOTE ${genre}: capped at ${MAX_ARTISTS_PER_GENRE} of ${total}`,
    )
  }
  console.log(`  ${genre} DONE: ${kept} artists placed`)
  return counts
}

async function main() {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  const data = loadExisting()
  console.log(
    `genre precompute start ${new Date().toISOString()} — done so far: [${data.meta.completed.join(', ')}]`,
  )

  for (const genre of GENRES) {
    if (data.meta.completed.includes(genre)) {
      console.log(`skip ${genre} (already complete)`)
      continue
    }
    console.log(`building ${genre}…`)
    data.genres[genre] = await buildGenre(genre)
    data.meta.completed.push(genre)
    data.meta.generatedAt = new Date().toISOString()
    writeFileSync(OUT_PATH, JSON.stringify(data))
    console.log(`saved after ${genre}`)
  }
  console.log(`ALL DONE ${new Date().toISOString()}`)
}

main().catch((error) => {
  console.error('precompute failed:', error)
  process.exit(1)
})
