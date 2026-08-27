/**
 * Historical-area roster build (owner go, Aug 27, 2026 — Proposal 1).
 *
 * Turns the committed audit (data/historical-area-audit.json) into a
 * served roster: the 1,144 artists filed under SU/YU/Czechoslovakia/
 * East Germany whose begin-area walks to a modern country, keyed by
 * that country, tag-enriched for ranking and the genre filter.
 *
 * Begin-area accepted as-is per owner ruling Aug 27 (the Asunción
 * mobility pattern is rare in Soviet-era careers; presence phase 3
 * refines persons later). The `polity` field is retained per row —
 * it is Phase C/D's seed data.
 *
 * Tags come from a fresh paginated area sweep (the audit discarded
 * them); resumable via data/historical-roster-work.json (gitignored).
 * Output: lib/explore/historical-area-artists.json (committed).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mbJson } from './lib/held-rerun-io.mjs'

const AREAS = [
  { code: 'SU', name: 'Soviet Union' },
  { code: 'YU', name: 'Yugoslavia' },
  { code: 'CS', name: 'Czechoslovakia' },
  { code: 'DD', name: 'East Germany' },
]
/** MB's own codes for the polity areas — self-walks are NOT modern homes. */
const POLITY_SELF = new Set(['SU', 'YU', 'XC', 'XG'])
const AUDIT_PATH = 'data/historical-area-audit.json'
const WORK_PATH = 'data/historical-roster-work.json'
const OUT_PATH = 'lib/explore/historical-area-artists.json'
const PAGE = 100

const work = existsSync(WORK_PATH)
  ? JSON.parse(readFileSync(WORK_PATH, 'utf8'))
  : { tags: {}, pagesDone: {} }

async function collectTags(area) {
  let offset = work.pagesDone[area.code] ?? 0
  let total = Infinity
  while (offset < total) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(
        `area:"${area.name}"`,
      )}&limit=${PAGE}&offset=${offset}&fmt=json`,
      'artists',
    )
    total = body.count ?? 0
    for (const artist of body.artists ?? []) {
      if ((artist.area?.name ?? null) !== area.name) continue
      const tags = (artist.tags ?? [])
        .filter((tag) => (tag.count ?? 0) > 0)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      work.tags[artist.id] = {
        names: tags.slice(0, 6).map((tag) => tag.name.toLowerCase()),
        votes: tags.reduce((sum, tag) => sum + (tag.count ?? 0), 0),
      }
    }
    offset += PAGE
    work.pagesDone[area.code] = offset
    writeFileSync(WORK_PATH, JSON.stringify(work))
    console.log(`  ${area.name}: ${Math.min(offset, total)}/${total}`)
  }
}

async function main() {
  for (const area of AREAS) await collectTags(area)

  const audit = JSON.parse(readFileSync(AUDIT_PATH, 'utf8'))
  const countries = {}
  let placed = 0
  for (const artist of audit.artists) {
    if (!artist.modernCountry || POLITY_SELF.has(artist.modernCountry)) continue
    const enriched = work.tags[artist.mbid] ?? { names: [], votes: 0 }
    const list = (countries[artist.modernCountry] ??= [])
    list.push({
      mbid: artist.mbid,
      name: artist.name,
      type: artist.type ?? null,
      lifeBegin: artist.life?.begin ? Number(String(artist.life.begin).slice(0, 4)) : null,
      lifeEnd: artist.life?.end ? Number(String(artist.life.end).slice(0, 4)) : null,
      ended: artist.life?.ended ?? false,
      tags: enriched.names,
      votes: enriched.votes,
      polity: artist.polity,
    })
    placed++
  }
  // Static order per country: own tag-vote weight, then name — the
  // served merge appends after the live-ranked pool and keeps this
  // order (no cross-scale ranking invented at request time).
  for (const list of Object.values(countries)) {
    list.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name))
  }
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'data/historical-area-audit.json + area tag sweep',
    countries,
  }
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 1))
  const sizes = Object.entries(countries)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cc, list]) => `${cc}:${list.length}`)
  console.log(`${placed} artists across ${Object.keys(countries).length} countries → ${OUT_PATH}`)
  console.log(sizes.join('  '))
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
