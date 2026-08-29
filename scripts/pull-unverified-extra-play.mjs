/**
 * Quarantine gap-fill YouTube play links with no identity evidence
 * (owner-ruled, Aug 30 2026 — "a play button that lands on the wrong
 * artist is the same class of problem as the phishing link").
 *
 *   node scripts/pull-unverified-extra-play.mjs [--dry]
 *
 * SCOPE (owner delegated the cut; this is the choice and why): a
 * committed youtube-video link KEEPS its verdict only when the upload
 * title corroborates the artist's name — the audit's reliable-positive
 * bar (an 11–12/12 sample), stacked on the release-attachment the
 * original sweep already had. Every other youtube-video entry is
 * quarantined: title doesn't name the artist, no title fetched, key no
 * longer maps to a dataset artist, or the video is gone. Archive-kind
 * entries are untouched (verified by exact-alias creator match — a
 * different, unbroken method), as are swept nulls.
 *
 * MECHANISM: `identityUnverified: true` on the entry. The committed
 * URL is PRESERVED for the repair pass — quarantine is an accessor
 * verdict (lib/explore/extraPlay.ts returns undefined, so the live
 * IA chain runs), not data destruction. The keep-bar here is weaker
 * than the John Mayer bar (name-in-title, not own-catalog-title);
 * the repair pass is expected to apply the full bar to BOTH buckets.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DATASET = join(ROOT, 'lib', 'explore', 'extra-play.json')
const DRY = process.argv.includes('--dry')

const dataset = JSON.parse(readFileSync(DATASET, 'utf8'))
const artistsByCountry = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'explore', 'extra-artists.json'), 'utf8'),
).countries

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

const nameOf = new Map()
for (const list of Object.values(artistsByCountry)) {
  for (const artist of list) {
    const key = extraPlayKey(artist)
    if (!nameOf.has(key)) nameOf.set(key, artist.name)
  }
}

function titleNamesArtist(title, artistName) {
  const name = norm(artistName ?? '')
  const upload = norm(title ?? '')
  // Both sides must be present for the comparison to mean anything.
  if (!name || !upload) return false
  const tokens = name.split(' ').filter((token) => token.length >= 4)
  return upload.includes(name) || tokens.some((token) => upload.includes(token))
}

const nextEntries = { ...dataset.entries }
let kept = 0
let quarantined = 0
const reasons = { uncorroborated: 0, untitled: 0, unmapped: 0, gone: 0 }
for (const [key, entry] of Object.entries(dataset.entries)) {
  if (entry.play?.kind !== 'youtube-video') continue
  const artistName = nameOf.get(key)
  const reason = entry.gone
    ? 'gone'
    : !artistName
      ? 'unmapped'
      : !entry.title
        ? 'untitled'
        : !titleNamesArtist(entry.title, artistName)
          ? 'uncorroborated'
          : null
  if (reason === null) {
    kept++
    continue
  }
  quarantined++
  reasons[reason]++
  nextEntries[key] = { ...entry, identityUnverified: true }
}

console.log(`youtube-video verdicts kept (title names the artist): ${kept}`)
console.log(`quarantined: ${quarantined}`)
for (const [reason, count] of Object.entries(reasons)) {
  console.log(`  ${reason}: ${count}`)
}
if (DRY) {
  console.log('\n--dry: nothing written')
  process.exit(0)
}
writeFileSync(
  DATASET,
  `${JSON.stringify({ ...dataset, entries: nextEntries }, null, 2)}\n`,
)
console.log(`\nwritten to ${DATASET}`)
