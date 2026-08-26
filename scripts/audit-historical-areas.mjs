/**
 * Historical-area coverage audit (owner-approved next action, Aug 26,
 * 2026 — "a real coverage gap, not a map feature").
 *
 * THE GAP, structural: country panels query MB with `country:{ISO2}`,
 * which resolves through the artist area's ISO code. Artists filed
 * under MB's historical country areas carry the HISTORICAL codes —
 * Soviet Union SU, Yugoslavia YU, Czechoslovakia CS (XC), East
 * Germany DD — so no modern panel's query can ever match them.
 *
 * This audit measures the gap and attributes it: every artist under
 * the four areas, with their begin-area walked up "part of" to a
 * MODERN country (MB's area hierarchy is current-world, so the walk
 * lands on today's map). Artists with no walkable begin-area are the
 * POLITY-ONLY class — no modern home exists for them; they are the
 * natural constituency of a future historical-polity pool (Phase C).
 *
 * REPORT ONLY. Resumable via data/historical-area-work.json
 * (gitignored); report committed to data/historical-area-audit.json.
 * MusicBrainz only, paced, zero wallet.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mbJson } from './lib/held-rerun-io.mjs'
import { areaToCountry } from './lib/held-rerun-evidence.mjs'

const AREAS = [
  { code: 'SU', name: 'Soviet Union' },
  { code: 'YU', name: 'Yugoslavia' },
  { code: 'CS', name: 'Czechoslovakia' },
  { code: 'DD', name: 'East Germany' },
]
const WORK_PATH = 'data/historical-area-work.json'
const REPORT_PATH = 'data/historical-area-audit.json'
const PAGE = 100

const work = existsSync(WORK_PATH)
  ? JSON.parse(readFileSync(WORK_PATH, 'utf8'))
  : { artists: {}, areaWalks: {}, pagesDone: {} }
const saveWork = () => writeFileSync(WORK_PATH, JSON.stringify(work))
const areaCache = new Map(Object.entries(work.areaWalks))

async function collect(area) {
  let offset = work.pagesDone[area.code] ?? 0
  let total = Infinity
  while (offset < total) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(
        `country:${area.code}`,
      )}&limit=${PAGE}&offset=${offset}&fmt=json`,
      'artists',
    )
    total = body.count ?? 0
    for (const artist of body.artists ?? []) {
      work.artists[artist.id] = {
        polity: area.code,
        name: artist.name,
        type: artist.type ?? null,
        life: artist['life-span'] ?? null,
        beginAreaId: artist['begin_area']?.id ?? artist['begin-area']?.id ?? null,
        beginAreaName:
          artist['begin_area']?.name ?? artist['begin-area']?.name ?? null,
        areaName: artist.area?.name ?? null,
      }
    }
    offset += PAGE
    work.pagesDone[area.code] = offset
    saveWork()
    console.log(`  ${area.name}: ${Math.min(offset, total)}/${total}`)
  }
}

async function main() {
  for (const area of AREAS) await collect(area)

  const beginIds = [
    ...new Set(
      Object.values(work.artists)
        .map((artist) => artist.beginAreaId)
        .filter(Boolean),
    ),
  ]
  const pending = beginIds.filter((id) => !(id in work.areaWalks))
  console.log(`${beginIds.length} unique begin-areas · ${pending.length} to walk`)
  let done = 0
  for (const id of pending) {
    try {
      work.areaWalks[id] = await areaToCountry(id, areaCache)
    } catch (error) {
      console.warn(`  walk ${id}: ${error.message} (retried next run)`)
      continue
    }
    done++
    if (done % 25 === 0) {
      saveWork()
      console.log(`  walks: ${done}/${pending.length}`)
    }
  }
  saveWork()

  const rows = Object.entries(work.artists).map(([mbid, artist]) => {
    const walked = artist.beginAreaId ? work.areaWalks[artist.beginAreaId] : null
    return { mbid, ...artist, modernCountry: walked?.code ?? null, modernName: walked?.name ?? null }
  })
  const byPolity = {}
  for (const polity of AREAS.map((area) => area.code)) {
    const subset = rows.filter((row) => row.polity === polity)
    const attribution = {}
    for (const row of subset) {
      const key = row.modernCountry ?? 'POLITY-ONLY'
      attribution[key] = (attribution[key] ?? 0) + 1
    }
    byPolity[polity] = {
      total: subset.length,
      attributable: subset.filter((row) => row.modernCountry).length,
      polityOnly: subset.filter((row) => !row.modernCountry).length,
      attribution: Object.fromEntries(
        Object.entries(attribution).sort((a, b) => b[1] - a[1]),
      ),
    }
  }
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    finding:
      'Country panels query MB with country:{ISO2}; artists under historical areas carry historical ISO codes (SU/YU/CS/DD) and are structurally invisible to every modern panel. Attribution below is via begin-area walked to the modern map; POLITY-ONLY artists have no walkable modern home and are the constituency of a future historical-polity pool.',
    byPolity,
    artists: rows.sort((a, b) => a.polity.localeCompare(b.polity) || a.name.localeCompare(b.name)),
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(Object.fromEntries(Object.entries(byPolity).map(([polity, stats]) => [polity, { total: stats.total, attributable: stats.attributable, polityOnly: stats.polityOnly }])), null, 1))
  console.log(`report → ${REPORT_PATH}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
