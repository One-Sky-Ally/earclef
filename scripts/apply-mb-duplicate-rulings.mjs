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
const EXTRA_PLAY_PATH = 'lib/explore/extra-play.json'
const CARRIED_PATH = 'lib/play/merged-duplicate-play.json'
const countryPath = (code) => `lib/explore/country-artists/${code}.json`

const RULED_ON = '2026-09-22'
const CARRIED_DOC =
  'Play links carried from a merged duplicate (owner brief, Nov 23 2026): when the owner keeps the MusicBrainz copy of a ' +
  'duplicated artist, the moved pool copy\'s verified link serves for mb:<mbid> instead. WRITTEN ONLY BY ' +
  'scripts/apply-mb-duplicate-rulings.mjs from owner-approved rulings, each pair hand-checked (handCheck). Only a link that ' +
  'already served for the pool copy (identity evidence, not quarantined) can be carried.'
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
  // Owner brief, Nov 23 2026: keep the MusicBrainz copy of each, move
  // the pool copy here, and carry its play link onto the MB copy — each
  // pair checked by hand first (evidence on the case), each applied
  // only once the owner approves THAT artist (drop a line back to
  // keep: 'deferred' to leave one out; re-running restores nothing). `carryPlay: false`
  // = the pool copy's link is NOT this artist's own performance, so
  // nothing is carried and the MB copy keeps its own chain.
  2297717: { code: 'KH', keep: 'mb', carryPlay: true, preparedOn: '2026-11-23', why: 'Same person: MusicBrainz links this exact Discogs page (2297717) and the same Wikidata item. Kept the MB copy (dated 1959–2024); the pool copy\'s ▶ is Kong Nay\'s own track from his 2003 album "Un barde cambodgien", on YouTube\'s official "Kong Nay - Topic" channel' },
  2745828: { code: 'VN', keep: 'mb', carryPlay: true, preparedOn: '2026-11-23', why: 'Same band: both are the Vietnamese symphonic/metal band UnlimiteD, with the same two releases (Tái sinh, Symphony). Kept the MB copy (from 2003); the pool copy\'s ▶ is the title track "Tái sinh", uploaded June 2010, years before an unrelated later hit of the same name' },
  1213338: { code: 'TT', keep: 'mb', carryPlay: true, preparedOn: '2026-11-23', why: 'Same person: MusicBrainz lists Neville Marcano as Growling Tiger\'s real name and links this exact Discogs page (1213338). Kept the MB copy (1931–1993); the pool copy\'s ▶ is "Dingo Lay" (Decca 1935) by the Keskidee Trio — Attila, Lord Beginner and Neville Marcano (The Tiger) — so he is one of three voices' },
  3039906: { code: 'PS', keep: 'mb', carryPlay: false, preparedOn: '2026-11-23', why: 'Same person: MusicBrainz links this exact Discogs page (3039906). Kept the MB copy (1941–2008). NOTHING CARRIED: the pool copy\'s only link was already quarantined (never served), and a hand check shows it is a 2024 Palestine Youth Orchestra concert of his poem set by Marcel Khalifé — not his own voice' },
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * The pool copy's play link, ready to carry onto the MB copy — only a
 * link that SERVES today (identity evidence, not quarantined). Carrying
 * never upgrades a link: what the pool copy could not play, the MB copy
 * does not get either.
 */
function servingPoolPlay(extraPlay, discogsId) {
  const key = `dg:${discogsId}`
  const entry = extraPlay.entries[key]
  if (!entry?.play || entry.identityUnverified || !entry.identityEvidence) return null
  return {
    fromKey: key,
    play: entry.play,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.durationSeconds ? { durationSeconds: entry.durationSeconds } : {}),
    identityEvidence: entry.identityEvidence,
  }
}

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
  const extraPlay = readJson(EXTRA_PLAY_PATH)
  const carried = {}
  const carryFor = (ruling, item) => {
    if (!ruling.carryPlay) return null
    // The pool copy may already be gone from the pool, but its play
    // entry stays in extra-play.json (keyed by Discogs id), so this
    // re-derives the same link on every run.
    const carry = servingPoolPlay(extraPlay, item.poolEntry.discogsArtistId)
    if (!carry) throw new Error(`${item.poolEntry.name}: carryPlay set but the pool copy has no serving link`)
    return carry
  }
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
    // The carried link is re-derived every run (the held file keeps
    // only which key it came from), so it must be computed before the
    // already-moved shortcut.
    if (ruling.keep === 'mb' && ruling.carryPlay) {
      const carry = carryFor(ruling, item)
      carried[`mb:${item.musicbrainz.mbid}`] = { name: item.musicbrainz.nameIndexRecord?.name ?? item.poolEntry.name, ...carry, handCheck: ruling.why }
    }
    // Already moved on a previous run: the stored record must survive —
    // an absent record on the site is not "nothing to move".
    const done = prior.get(String(item.poolEntry.discogsArtistId))
    if (done) {
      cases.push({ ...done, moved: `${String(done.moved).replace(/ \(already on record\)$/, '')} (already on record)` })
      return current
    }
    if (ruling.keep === 'mb') {
      const carry = carryFor(ruling, item)
      const { pool: next, moved } = movePoolCopy(current, item)
      cases.push({
        ...base,
        ...(ruling.preparedOn ? { preparedOn: ruling.preparedOn } : {}),
        kept: 'mb',
        moved: moved ? 'pool' : 'already-absent',
        movedRecord: moved,
        playCarried: carry ? carry.fromKey : null,
        evidence,
      })
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
  writeFileSync(
    CARRIED_PATH,
    `${JSON.stringify({ _doc: CARRIED_DOC, links: carried }, null, 2)}\n`,
  )
  for (const item of cases) console.log(`${item.country} ${item.name}: kept ${item.kept}, moved ${item.moved}`)
  for (const item of kept) console.log(`${item.country} ${item.name}: kept pool, ${item.moved}`)
  for (const item of deferred) console.log(`${item.country} ${item.name}: DEFERRED — ${item.why}`)
  console.log(`→ ${HELD_PATH}: ${cases.length} moved, ${kept.length} kept as-is, ${deferred.length} deferred`)
}

main()
