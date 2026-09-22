/**
 * MB-DUPLICATE RULINGS (owner, Sep 22, 2026) — for each pool entry the
 * occupation-filter review verified BY ID as an artist MusicBrainz
 * already has (data/occupation-filter-duplicate-review.json), keep
 * whichever copy is better on the site and MOVE the other into
 * data/mb-duplicates-held.json with the evidence attached. Nothing is
 * deleted: the moved record is stored whole and can be put back.
 *
 * "Better on the site" as applied here, in order: (1) the copy shows
 * on the era globe — an undated MB copy (cs null) never places on a
 * year and ranks last; (2) the copy carries a verified ▶. A pair where
 * those two disagree is DEFERRED to the owner, untouched.
 *
 * The two kinds of move:
 *   pool → held   the entry leaves lib/explore/extra-artists.json
 *   mb   → held   the record leaves lib/explore/country-artists/<CC>.json
 *                 (inspected/undated counts follow); build-country-data
 *                 reads the held file so a regen cannot resurrect it.
 * Idempotent: a record already absent is reported, not re-moved.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const REVIEW_PATH = 'data/occupation-filter-duplicate-review.json'
const HELD_PATH = 'data/mb-duplicates-held.json'
const POOL_PATH = 'lib/explore/extra-artists.json'
const countryPath = (code) => `lib/explore/country-artists/${code}.json`

const RULED_ON = '2026-09-22'
const RULING =
  'Owner, Sep 22 2026: for each verified duplicate keep whichever copy is better on the site and move the other ' +
  'to this held file with the evidence attached; nothing gets deleted. The five name-only cases stay in the pool. ' +
  'Mahmoud Darwish stays under the spoken-word ruling: Discogs files "À L\'Ombre Des Mots" (France 2009) and its ' +
  'Palestinian pressing "في ظل الكلام" as joint artist credits with Le Trio Joubran under a music genre — his ' +
  'readings over music, released.'

/** Every verified pair, by the pool entry's Discogs id. */
const RULINGS = {
  5081591: { code: 'MW', keep: 'mb', why: 'MB copy dated 1967–2021 with tags; pool copy 2011–15 from two releases, no ▶' },
  538540: { code: 'ET', keep: 'pool', why: 'MB copy undated (never places on a year); pool copy dated 1974 with a verified ▶' },
  2032849: { code: 'TT', keep: 'pool', why: 'MB copy undated; pool copy dated 1951–56 from 12 releases with a verified ▶' },
  893312: { code: 'TT', keep: 'pool', why: 'MB copy undated; pool copy dated 1948–55 from 11 releases with an archive ▶' },
  8529357: { code: 'VN', keep: 'pool', why: 'MB knows the artist but files no copy on the site for VN — nothing to move' },
  2823955: { code: 'KZ', keep: 'pool', why: 'MB copy is filed under the Soviet Union (owner ruling Aug 11 2026: residence, not origin) — nothing on the KZ site to move' },
  2297717: { code: 'KH', keep: 'deferred', why: 'MB copy dated 1959–2024 but silent; pool copy 2012 (one release) with the only verified ▶' },
  2745828: { code: 'VN', keep: 'deferred', why: 'MB copy dated 2003 with a YouTube channel relation; pool copy 2009 with the only verified ▶' },
  1213338: { code: 'TT', keep: 'deferred', why: 'MB copy "Growling Tiger" dated 1931–1993 but silent; pool copy 1935 with the only verified ▶' },
  3039906: { code: 'PS', keep: 'deferred', why: 'MB copy dated 1956–2008 but silent; pool copy undated with the only verified ▶ (stays as an artist under the spoken-word ruling)' },
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** MB copy on the site for this pair, or null when the country file lacks it. */
function siteMbCopy(code, mbid) {
  const stored = readJson(countryPath(code))
  return stored.artists.find((artist) => artist.id === mbid) ?? null
}

function movePoolCopy(pool, review) {
  const id = String(review.poolEntry.discogsArtistId)
  const list = pool.countries[review.country]
  const entry = list.find((artist) => String(artist.discogsArtistId) === id) ?? null
  if (!entry) return { pool, moved: null }
  return {
    pool: {
      ...pool,
      countries: { ...pool.countries, [review.country]: list.filter((artist) => artist !== entry) },
    },
    moved: entry,
  }
}

function moveMbCopy(code, mbid) {
  const stored = readJson(countryPath(code))
  const record = stored.artists.find((artist) => artist.id === mbid) ?? null
  if (!record) return null
  const next = {
    ...stored,
    inspected: stored.inspected - 1,
    undated: record.cs === null ? stored.undated - 1 : stored.undated,
    artists: stored.artists.filter((artist) => artist !== record),
  }
  writeFileSync(countryPath(code), JSON.stringify(next) + '\n')
  return record
}

/** A move already on record: the held file, not the site, says so. */
function priorCases() {
  if (!existsSync(HELD_PATH)) return new Map()
  const held = readJson(HELD_PATH)
  return new Map(held.cases.filter((item) => item.movedRecord).map((item) => [String(item.discogsArtistId), item]))
}

function main() {
  const review = readJson(REVIEW_PATH)
  const initialPool = readJson(POOL_PATH)
  const prior = priorCases()
  const cases = []
  const kept = []
  const deferred = []

  const pool = review.reviews.reduce((current, item) => {
    const ruling = RULINGS[item.poolEntry.discogsArtistId]
    if (!ruling) return current // the five name-only cases: untouched
    const evidence = { verdict: item.verdict, musicbrainz: item.musicbrainz, wikidataItem: item.wikidataItem, corroboration: item.corroboration }
    const base = { country: item.country, name: item.poolEntry.name, mbid: item.musicbrainz.mbid, discogsArtistId: item.poolEntry.discogsArtistId, why: ruling.why }
    if (ruling.keep === 'deferred') {
      deferred.push({ ...base, awaiting: 'owner picks the copy: dated-but-silent MB vs. audible pool' })
      return current
    }
    // Already moved on a previous run: the stored record must survive —
    // an absent record on the site is not "nothing to move".
    const done = prior.get(String(item.poolEntry.discogsArtistId))
    if (done) {
      cases.push({ ...done, moved: `${done.moved} (already on record)` })
      return current
    }
    if (ruling.keep === 'mb') {
      const { pool: next, moved } = movePoolCopy(current, item)
      cases.push({ ...base, kept: 'mb', moved: moved ? 'pool' : 'already-absent', movedRecord: moved, evidence })
      return next
    }
    const mbCopy = siteMbCopy(item.country, item.musicbrainz.mbid)
    if (!mbCopy) {
      kept.push({ ...base, kept: 'pool', moved: 'nothing-on-site', evidence })
      return current
    }
    const moved = moveMbCopy(item.country, item.musicbrainz.mbid)
    cases.push({ ...base, kept: 'pool', moved: moved ? 'mb' : 'already-absent', movedRecord: moved, evidence })
    return current
  }, initialPool)

  writeFileSync(POOL_PATH, `${JSON.stringify(pool, null, 2)}\n`)
  writeFileSync(
    HELD_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), ruledOn: RULED_ON, ruling: RULING, cases, kept, deferred }, null, 1),
  )
  for (const item of cases) console.log(`${item.country} ${item.name}: kept ${item.kept}, moved ${item.moved}`)
  for (const item of kept) console.log(`${item.country} ${item.name}: kept pool, ${item.moved}`)
  for (const item of deferred) console.log(`${item.country} ${item.name}: DEFERRED — ${item.why}`)
  console.log(`→ ${HELD_PATH}: ${cases.length} moved, ${kept.length} kept as-is, ${deferred.length} deferred`)
}

main()
