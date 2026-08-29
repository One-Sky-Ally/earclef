/**
 * Identity audit of the committed gap-fill play links.
 *
 *   node scripts/audit-extra-play-identity.mjs
 *
 * FOUND Aug 30, 2026, by enriching extra-play.json with upload titles:
 * the committed links frequently point at the WRONG ARTIST. "T.O. Jazz"
 * (Ghana) plays a Leipzig boys' choir carol; "C.K. Mann & His Carousel
 * 7" plays Keith Jarrett's Köln Concert; Louis Armstrong plays a techno
 * remix. The URLs are unchanged since the original sweep — enrichment
 * only made them legible.
 *
 * ROOT CAUSE (scripts/build-extra-play.mjs, discogsReleaseVideoIds):
 * it collects every community-submitted video attached to a Discogs
 * release the artist appears on, stops at the first release carrying
 * any video, and takes the first PLAYABLE id. On a compilation or
 * various-artists release those videos are other artists' tracks, and
 * playability says nothing about whose record it is. Standing lesson 1
 * exactly: the release was verified against the artist, and the halo
 * was extended to videos merely attached to it.
 *
 * WHAT THIS SCRIPT DOES — TRIAGE, NOT VERDICT. It reports whether the
 * upload title corroborates the artist's name. A title that does NOT
 * name the artist is NOT thereby wrong: a correct link often carries
 * only the song title ("Odo Mmera" for African Brothers), and a correct
 * link in another script cannot match a Latin name (陳寶珠 IS Connie
 * Chan Po Chu). So the uncorroborated bucket mixes true errors with
 * unmatchable-but-correct entries, and no automated rule separates
 * them — deciding is the owner's, on evidence, per artist or per class.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, 'data', 'gap-fill-play-identity-audit.json')

const play = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'explore', 'extra-play.json'), 'utf8'),
).entries
const dataset = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'explore', 'extra-artists.json'), 'utf8'),
)

function djb2(value) {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

/** MUST mirror extraPlayKey in lib/explore/extraArtists.ts exactly. */
function extraPlayKey(artist) {
  if (artist.discogsArtistId) return `dg:${artist.discogsArtistId}`
  if (artist.wikidataId) return `wd:${artist.wikidataId}`
  const slug = artist.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `nm:${slug || `h${djb2(artist.name)}`}`
}

const norm = (value) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** playKey → {name, countries} across the whole gap-fill dataset. */
const artistOf = new Map()
for (const [code, list] of Object.entries(dataset.countries)) {
  for (const artist of list) {
    const key = extraPlayKey(artist)
    const existing = artistOf.get(key)
    artistOf.set(key, {
      name: existing?.name ?? artist.name,
      countries: [...new Set([...(existing?.countries ?? []), code])],
    })
  }
}

const corroborated = []
const uncorroborated = []
for (const [key, entry] of Object.entries(play)) {
  if (entry.play?.kind !== 'youtube-video' || !entry.title) continue
  const artist = artistOf.get(key)
  if (!artist) continue
  const name = norm(artist.name)
  const title = norm(entry.title)
  const tokens = name.split(' ').filter((part) => part.length >= 4)
  const row = {
    key,
    artist: artist.name,
    countries: artist.countries,
    title: entry.title,
    url: entry.play.url,
    durationSeconds: entry.durationSeconds ?? null,
    queueEligible: entry.queueEligible !== false,
  }
  // Both sides must be present for the comparison to mean anything.
  const hit =
    Boolean(name) &&
    Boolean(title) &&
    (title.includes(name) || tokens.some((token) => title.includes(token)))
  if (hit) corroborated.push(row)
  else uncorroborated.push(row)
}

const total = corroborated.length + uncorroborated.length
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      method:
        'Triage only: does the upload title contain the artist name (or a 4+ char token of it)? An uncorroborated row is NOT thereby wrong — see the header of scripts/audit-extra-play-identity.mjs.',
      total,
      corroborated: corroborated.length,
      uncorroborated: uncorroborated.length,
      rows: uncorroborated,
    },
    null,
    2,
  )}\n`,
)

console.log(`titled youtube links: ${total}`)
console.log(
  `title names the artist:      ${corroborated.length} (${((100 * corroborated.length) / total).toFixed(1)}%)`,
)
console.log(
  `title does NOT name them:    ${uncorroborated.length} (${((100 * uncorroborated.length) / total).toFixed(1)}%)`,
)
console.log(`\nuncorroborated rows written to ${OUT}`)
console.log('NOT an error count — triage for the owner to rule on.')
