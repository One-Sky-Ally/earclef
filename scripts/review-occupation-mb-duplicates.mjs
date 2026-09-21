/**
 * READ-ONLY REVIEW (Sep 2026) — the pool entries that the wider
 * occupation probe says MusicBrainz may already know
 * (data/occupation-filter-lists.json → possibleMbDuplicatesInPool).
 *
 * Identity is decided on IDS ONLY, never on name similarity, and every
 * equality needs both sides present (standing lesson 5):
 *   leg A  MusicBrainz's own curated Discogs link  == the pool entry's Discogs id
 *   leg B  Wikidata P1953                          == the pool entry's Discogs id
 *   leg C  MusicBrainz's own Wikidata link         == the Wikidata item (P434 back-check)
 * Verdicts: same-verified (A, or B+C) · same-one-leg (B only) ·
 * different-discogs-page (ids present on both sides, none equal) ·
 * unverifiable (an id is missing — a name match alone decides nothing).
 * For the owner's judgment each review also carries `corroboration`:
 * release titles that are EXACTLY equal (normalized, non-empty) between
 * the pool entry's Discogs credits and the MB artist's release groups.
 * A near-miss title is not a match and is not counted.
 *
 * Writes data/occupation-filter-duplicate-review.json. Changes nothing:
 * nothing is deleted or moved until the owner rules on the report.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { artistLinksAvailable, discogsIdsFor, wikidataQidsFor } from './lib/mbArtistLinks.mjs'
import { artistsNamed } from './lib/mbNameIndex.mjs'
import { releaseGroupsFor } from './lib/mbDumpIndex.mjs'
import { releasesFor } from './lib/discogsDump.mjs'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'

const LISTS_PATH = 'data/occupation-filter-lists.json'
const OUT_PATH = 'data/occupation-filter-duplicate-review.json'

function verdictFor({ poolDiscogsId, wikidataDiscogsId, mbDiscogsIds, mbLinksBackToItem }) {
  const legA = poolDiscogsId !== null && mbDiscogsIds.includes(poolDiscogsId)
  const legB = poolDiscogsId !== null && wikidataDiscogsId !== null && poolDiscogsId === wikidataDiscogsId
  if (legA || (legB && mbLinksBackToItem)) return 'same-verified'
  if (legB) return 'same-one-leg'
  if (poolDiscogsId !== null && mbDiscogsIds.length > 0) return 'different-discogs-page'
  return 'unverifiable'
}

const normalizeTitle = (value) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Exact shared release titles — both sides present, empty never matches. */
function sharedTitles(code, poolDiscogsId, mbid) {
  if (poolDiscogsId === null) return { discogsTitles: [], mbTitles: [], shared: [] }
  const discogsTitles = new Map()
  for (const country of COUNTRIES[code].discogs ?? []) {
    for (const release of releasesFor(country) ?? []) {
      const credited = (release.artists ?? []).some((credit) => String(credit.id) === poolDiscogsId)
      const key = normalizeTitle(release.title ?? '')
      if (credited && key !== '') discogsTitles.set(key, release.title)
    }
  }
  const mbTitles = releaseGroupsFor(mbid).map((group) => group.title)
  const shared = mbTitles.filter((title) => {
    const key = normalizeTitle(title)
    return key !== '' && discogsTitles.has(key)
  })
  return { discogsTitles: [...discogsTitles.values()], mbTitles, shared }
}

function reviewOne(code, record) {
  const poolDiscogsId = record.poolEntry.discogsArtistId != null ? String(record.poolEntry.discogsArtistId) : null
  const wikidataDiscogsId = record.discogsId != null ? String(record.discogsId) : null
  const mbDiscogsIds = (discogsIdsFor(record.mbid) ?? []).map(String)
  const mbLinksBackToItem = (wikidataQidsFor(record.mbid) ?? []).includes(record.wikidataId)
  const mbArtist = artistsNamed(record.name).find((artist) => artist.id === record.mbid) ?? null
  return {
    country: code,
    poolEntry: record.poolEntry,
    wikidataItem: { id: record.wikidataId, name: record.name, discogsId: wikidataDiscogsId, classes: record.classes },
    musicbrainz: {
      mbid: record.mbid,
      discogsIds: mbDiscogsIds,
      linksBackToWikidataItem: mbLinksBackToItem,
      // Context for the owner's eye only — never part of the verdict.
      nameIndexRecord: mbArtist
        ? { name: mbArtist.name, type: mbArtist.type, area: mbArtist.area?.name ?? null, disambiguation: mbArtist.disambiguation ?? null }
        : null,
    },
    verdict: verdictFor({ poolDiscogsId, wikidataDiscogsId, mbDiscogsIds, mbLinksBackToItem }),
    corroboration: sharedTitles(code, poolDiscogsId, record.mbid),
  }
}

function main() {
  if (!artistLinksAvailable()) throw new Error('local MB artist-link index missing — cannot review without it')
  const lists = JSON.parse(readFileSync(LISTS_PATH, 'utf8'))
  const reviews = Object.entries(lists.countries).flatMap(([code, country]) =>
    country.possibleMbDuplicatesInPool.map((record) => reviewOne(code, record)),
  )
  const counts = reviews.reduce((acc, review) => ({ ...acc, [review.verdict]: (acc[review.verdict] ?? 0) + 1 }), {})
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), status: 'REPORT ONLY — nothing changed', counts, reviews }, null, 1),
  )
  for (const review of reviews) {
    console.log(
      `${review.country} ${review.poolEntry.name} [pool dg:${review.poolEntry.discogsArtistId ?? '—'}, by ${review.poolEntry.matchedBy}]` +
        ` → ${review.verdict} (MB dg:${review.musicbrainz.discogsIds.join(',') || '—'}; WD dg:${review.wikidataItem.discogsId ?? '—'};` +
        ` MB→WD ${review.musicbrainz.linksBackToWikidataItem}; shared titles ${review.corroboration.shared.length})`,
    )
  }
  console.log(JSON.stringify(counts))
}

main()
