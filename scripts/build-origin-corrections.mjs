/**
 * ORIGIN CORRECTIONS: catch artists a country pool claims by RESIDENCE
 * or CITIZENSHIP rather than musical origin.
 *
 * MusicBrainz's artist `country:` search field is derived from the
 * artist's AREA — where they are now / whose passport they hold — not
 * from where they started. Tina Turner (born Nutbush, Tennessee; Swiss
 * citizen from the 1990s) therefore ranks #1 in Switzerland's pool.
 * The US-states precompute already avoided this by preferring
 * begin-area; this brings countries in line.
 *
 * MB cannot answer "born anywhere in Switzerland" — `beginarea:` matches
 * an area NAME, not its hierarchy — so this resolves each artist's
 * begin-area up the "part of" chain to a country, exactly like the
 * states pipeline, and commits the verdicts.
 *
 * OUTPUT (lib/explore/origin-corrections.json):
 *   moves: { "<mbid>": { from, to, name, begin } }
 * The route drops a moved artist from `from` and adds them to `to`.
 * Nothing is invented: a move needs a begin-area that RESOLVES to a
 * different country. No begin-area = no opinion = left alone.
 *
 * Usage: node scripts/build-origin-corrections.mjs [CC ...]
 * Resumable via data/origin-corrections-work.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const WORK_PATH = 'data/origin-corrections-work.json'
const OUT_PATH = 'lib/explore/origin-corrections.json'
const REPORT_PATH = 'data/origin-corrections-report.json'
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const DELAY_MS = 1100
const PAGE_SIZE = 100
/** Mirrors the panel route: two pages, tag-weight ranked. */
const PAGES = 2
const MAX_HOPS = 6

/**
 * Countries swept by default: the big music markets plus the small,
 * wealthy or expat-magnet countries where ONE misattributed star
 * distorts the whole pool (the Switzerland case).
 */
const DEFAULT_COUNTRIES = [
  'CH', 'MC', 'LU', 'LI', 'IE', 'AT', 'BE', 'NL', 'SE', 'NO', 'DK', 'FI',
  'IS', 'PT', 'ES', 'IT', 'FR', 'DE', 'GB', 'US', 'CA', 'AU', 'NZ', 'JP',
  'BR', 'AR', 'MX', 'JM', 'CU', 'ZA', 'NG', 'IN', 'SG', 'AE', 'IL', 'GR',
  'CZ', 'PL', 'RU', 'TR', 'TH', 'PH', 'MY', 'ID', 'KR', 'CN', 'BS', 'BB',
  'MT', 'CY', 'PA', 'CR', 'UY', 'PY', 'LA',
]

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_COUNTRIES

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function mbJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.status === 503 || res.status === 429) {
        await sleep(3000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch (error) {
      if (attempt === 4) throw error
      await sleep(2500 * attempt)
    }
  }
  throw new Error('unreachable')
}

/**
 * Resolve an area to its ISO country code by walking "part of"
 * parents. Every area passed on the way is cached — resolving
 * "Nutbush" also settles Haywood County and Tennessee.
 */
async function areaCountry(areaId, cache) {
  const chain = []
  let currentId = areaId
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (cache[currentId] !== undefined) {
      for (const id of chain) cache[id] = cache[currentId]
      return cache[currentId]
    }
    chain.push(currentId)
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/area/${currentId}?inc=area-rels&fmt=json`,
    )
    await sleep(DELAY_MS)
    const iso = (body['iso-3166-1-codes'] ?? [])[0]
    if (iso) {
      for (const id of chain) cache[id] = iso
      return iso
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

/** The country pool exactly as the panel builds it. */
async function countryPool(code) {
  const artists = []
  const seen = new Set()
  for (let page = 0; page < PAGES; page++) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`country:${code}`)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fmt=json`,
    )
    await sleep(DELAY_MS)
    for (const artist of body.artists ?? []) {
      if (seen.has(artist.id)) continue
      seen.add(artist.id)
      const tags = (artist.tags ?? []).filter((tag) => (tag.count ?? 0) > 0)
      artists.push({
        id: artist.id,
        name: artist.name,
        type: artist.type,
        begin: artist['life-span']?.begin?.slice(0, 4) ?? null,
        end: artist['life-span']?.end?.slice(0, 4) ?? null,
        weight: tags.reduce((sum, tag) => sum + (tag.count ?? 0), 0),
        tags: tags
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
          .slice(0, 4)
          .flatMap((tag) => (tag.name ? [tag.name] : [])),
        beginAreaId: artist['begin-area']?.id ?? null,
        beginAreaName: artist['begin-area']?.name ?? null,
      })
      if ((body.count ?? 0) <= (page + 1) * PAGE_SIZE) break
    }
  }
  // Panel order: tag weight descending — the names guests actually see.
  return artists.sort((a, b) => b.weight - a.weight)
}

async function main() {
  mkdirSync('data', { recursive: true })
  const work = loadJson(WORK_PATH, { areas: {}, countries: {} })

  for (const code of targets) {
    const state = (work.countries[code] ??= {})
    if (!state.pool) {
      console.log(`\n=== ${code}: fetching pool…`)
      state.pool = await countryPool(code)
      writeFileSync(WORK_PATH, JSON.stringify(work))
    }
    const pool = state.pool
    const withBegin = pool.filter((artist) => artist.beginAreaId)
    console.log(
      `=== ${code}: ${pool.length} artists, ${withBegin.length} with a begin-area`,
    )

    state.verdicts ??= {}
    let checked = 0
    for (const artist of withBegin) {
      if (state.verdicts[artist.id] !== undefined) continue
      const born = await areaCountry(artist.beginAreaId, work.areas)
      state.verdicts[artist.id] = born
      checked++
      if (checked % 15 === 0) {
        writeFileSync(WORK_PATH, JSON.stringify(work))
        console.log(`    ${checked}/${withBegin.length} resolved`)
      }
    }
    writeFileSync(WORK_PATH, JSON.stringify(work))

    const mismatches = withBegin.filter((artist) => {
      const born = state.verdicts[artist.id]
      return born && born !== code
    })
    state.mismatches = mismatches.map((artist) => ({
      id: artist.id,
      name: artist.name,
      rank: pool.findIndex((entry) => entry.id === artist.id) + 1,
      weight: artist.weight,
      bornIn: state.verdicts[artist.id],
      beginArea: artist.beginAreaName,
      begin: artist.begin,
      end: artist.end,
      tags: artist.tags,
    }))
    console.log(
      `    ${state.mismatches.length} claimed by residence, not origin` +
        (state.mismatches.length
          ? `: ${state.mismatches
              .slice(0, 5)
              .map((m) => `${m.name} (#${m.rank} → ${m.bornIn})`)
              .join(', ')}`
          : ''),
    )
    writeFileSync(WORK_PATH, JSON.stringify(work))
  }

  // Commit the moves + a human-readable report.
  const moves = {}
  const report = {}
  for (const code of targets) {
    const state = work.countries[code]
    if (!state?.mismatches) continue
    report[code] = {
      pool: state.pool.length,
      moved: state.mismatches.length,
      topTenAffected: state.mismatches.filter((m) => m.rank <= 10).length,
      artists: state.mismatches
        .sort((a, b) => a.rank - b.rank)
        .map((m) => `#${m.rank} ${m.name} → ${m.bornIn} (born ${m.beginArea})`),
    }
    for (const mismatch of state.mismatches) {
      moves[mismatch.id] = {
        from: code,
        to: mismatch.bornIn,
        name: mismatch.name,
        begin: mismatch.begin,
        end: mismatch.end,
        weight: mismatch.weight,
        tags: mismatch.tags,
        beginArea: mismatch.beginArea,
      }
    }
  }
  const existing = loadJson(OUT_PATH, { moves: {} })
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        moves: { ...existing.moves, ...moves },
      },
      null,
      2,
    ),
  )
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`\nDone → ${OUT_PATH} (${Object.keys(moves).length} moves)`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
