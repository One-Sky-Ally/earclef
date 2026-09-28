/**
 * ORIGIN HOLD — FOREIGN-CATALOG ENTRIES WITH NO RULING (owner, Sep 28,
 * 2026): "under my origin rule, move them to a held list until there's
 * evidence they performed or were based there. Nothing gets deleted."
 *
 * WHO. The Aug 25 crosswalk audit (data/gapfill-crosswalk-report.json)
 * linked gap-fill entries to MusicBrainz BY ID — MB's own Discogs url
 * relation, no name matching — and classed 801 as `foreign-catalog`:
 * MusicBrainz files the artist's area in a different country from the
 * pool that lists them (Nigeria 70 in Ghana, Lionel Richie in Paraguay).
 * The audit was report-only. This moves the ones nothing has ruled on:
 * an entry stays in its pool when ANY of these says someone decided —
 *   - its case key (CC|dg|ID) appears in the ruling files (pattern
 *     ruling overrides and report, the held-ruling re-run report);
 *   - it carries a presence edge, a keep-note, drift retention or a
 *     reinstatement (all written onto entries by owner rulings).
 * Re-derived from the files on every run (standing lesson 8), never
 * from a count remembered elsewhere.
 *
 * WHAT A MOVE IS. The entry leaves lib/explore/extra-artists.json and is
 * stored WHOLE in data/origin-held.json with the MB evidence beside it.
 * Its play link in extra-play.json is untouched (keyed by Discogs id,
 * shared with any other pool the artist legitimately appears in).
 * scripts/build-extra-artists.mjs reads the held file (via
 * scripts/lib/originHeld.mjs) so a sweep cannot re-append a held artist.
 *
 * PUTTING ONE BACK. When evidence arrives that the artist performed or
 * was based in the pool country, `--release CC|dg|ID` returns the stored
 * record to its pool unchanged and records the release (with the reason
 * given after `--because`). Nothing here decides that evidence.
 *
 * Idempotent: a case already on record is kept, not re-moved.
 *
 *   node scripts/hold-origin-foreign-catalog.mjs            # dry run
 *   node scripts/hold-origin-foreign-catalog.mjs --write
 *   node scripts/hold-origin-foreign-catalog.mjs --release GH|dg|639889 --because "…" --write
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { byDatedThenPressed } from './lib/gapFillMerge.mjs'

const CROSSWALK_PATH = 'data/gapfill-crosswalk-report.json'
const POOL_PATH = 'lib/explore/extra-artists.json'
const HELD_PATH = 'data/origin-held.json'
const RULING_FILES = [
  'data/pattern-ruling-overrides.json',
  'data/pattern-ruling-report.json',
  'data/held-ruling-rerun-report.json',
]

const RULED_ON = '2026-09-28'
const RULING =
  'Owner, Sep 28 2026: the gap-fill entries MusicBrainz files in another country (crosswalk audit, class ' +
  'foreign-catalog) with no ruling are moved to this held list under the origin rule, until there is evidence ' +
  'they performed or were based in the pool country. Nothing gets deleted: each record is stored whole.'

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
const releaseAt = argv.indexOf('--release')
const RELEASE = releaseAt === -1 ? null : argv[releaseAt + 1]
const becauseAt = argv.indexOf('--because')
const BECAUSE = becauseAt === -1 ? null : argv[becauseAt + 1]

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const caseKey = (code, id) => `${code}|dg|${id}`

function loadHeld() {
  return existsSync(HELD_PATH)
    ? readJson(HELD_PATH)
    : { generatedAt: null, ruledOn: RULED_ON, ruling: RULING, cases: [], released: [] }
}

/** Why an entry counts as already decided, or null when nothing has. */
function ruledBasis(entry, key, rulingText) {
  if (rulingText.includes(key)) return 'ruling-files'
  if (entry.presence) return 'presence'
  if (entry.note) return 'note'
  if (entry.retainedFrom) return 'retained'
  if (entry.reinstatedBy) return 'reinstated'
  return null
}

function hold() {
  const crosswalk = readJson(CROSSWALK_PATH)
  const pool = readJson(POOL_PATH)
  const held = loadHeld()
  const rulingText = RULING_FILES.filter(existsSync)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
  const onRecord = new Set(held.cases.map((item) => item.caseKey))
  const released = new Set((held.released ?? []).map((item) => item.caseKey))

  const countries = { ...pool.countries }
  const moved = []
  const stats = { foreignCatalogRows: 0, entries: 0, alreadyHeld: 0, notInPool: 0, released: 0, ruled: {} }
  // One ENTRY per pool + Discogs id. A few Discogs pages link two MB
  // artists (African Fiesta National / Orchestre Afrisa International),
  // so the report can carry two rows for one entry — both are evidence.
  const byKey = new Map()
  for (const leak of crosswalk.leaks) {
    if (leak.class !== 'foreign-catalog') continue
    stats.foreignCatalogRows++
    const key = caseKey(leak.pool, leak.discogsArtistId)
    byKey.set(key, [...(byKey.get(key) ?? []), leak])
  }
  for (const [key, rows] of byKey) {
    const leak = rows[0]
    stats.entries++
    if (onRecord.has(key)) {
      stats.alreadyHeld++
      continue
    }
    // A released case came back on evidence — never re-hold it here.
    if (released.has(key)) {
      stats.released++
      continue
    }
    const list = countries[leak.pool] ?? []
    const entry = list.find(
      (artist) => String(artist.discogsArtistId) === String(leak.discogsArtistId),
    )
    if (!entry) {
      stats.notInPool++
      continue
    }
    const basis = ruledBasis(entry, key, rulingText)
    if (basis) {
      stats.ruled[basis] = (stats.ruled[basis] ?? 0) + 1
      continue
    }
    countries[leak.pool] = list.filter((artist) => artist !== entry)
    moved.push({
      caseKey: key,
      country: leak.pool,
      name: entry.name,
      discogsArtistId: entry.discogsArtistId,
      reason: 'foreign-catalog-unruled',
      evidence: {
        source: CROSSWALK_PATH,
        method: crosswalk.method,
        musicbrainz: rows.map((row) => ({
          mbid: row.mbid,
          mbName: row.mbName,
          mbArea: row.mbArea,
          mbAreaCountry: row.mbAreaCountry,
          mbBeginArea: row.mbBeginArea,
          mbDisambiguation: row.mbDisambiguation,
        })),
      },
      edgeNeeded: 'performed or based in the pool country',
      movedRecord: entry,
    })
  }

  const byCountry = {}
  for (const item of moved) byCountry[item.country] = (byCountry[item.country] ?? 0) + 1
  console.log(
    `foreign-catalog ${stats.foreignCatalogRows} rows = ${stats.entries} entries: already held ${stats.alreadyHeld}, released ${stats.released}, ` +
      `no longer in pool ${stats.notInPool}, ruled ${JSON.stringify(stats.ruled)}, TO MOVE ${moved.length}`,
  )
  console.log(`by pool: ${JSON.stringify(Object.entries(byCountry).sort((a, b) => b[1] - a[1]))}`)

  if (!WRITE) {
    console.log('dry run — nothing written (add --write)')
    return
  }
  const before = Object.values(pool.countries).reduce((n, list) => n + list.length, 0)
  const after = Object.values(countries).reduce((n, list) => n + list.length, 0)
  // Nothing is deleted: every entry that left the pool is in the held file.
  if (before - after !== moved.length) {
    throw new Error(`pool shrank by ${before - after} but ${moved.length} were moved — nothing written`)
  }
  writeFileSync(POOL_PATH, `${JSON.stringify({ ...pool, countries }, null, 2)}\n`)
  writeFileSync(
    HELD_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        ruledOn: RULED_ON,
        ruling: RULING,
        cases: [...held.cases, ...moved],
        released: held.released ?? [],
      },
      null,
      1,
    )}\n`,
  )
  console.log(`→ ${POOL_PATH}: ${before} → ${after}\n→ ${HELD_PATH}: ${held.cases.length + moved.length} held`)
}

function release(key) {
  if (!BECAUSE) throw new Error('--release needs --because "<the evidence>"')
  const held = loadHeld()
  const item = held.cases.find((entry) => entry.caseKey === key)
  if (!item) throw new Error(`${key} is not on the held list`)
  const pool = readJson(POOL_PATH)
  const list = pool.countries[item.country] ?? []
  if (list.some((artist) => String(artist.discogsArtistId) === String(item.discogsArtistId))) {
    throw new Error(`${key} is already in the ${item.country} pool`)
  }
  console.log(`release ${key} (${item.name}) → ${item.country}: ${BECAUSE}`)
  if (!WRITE) {
    console.log('dry run — nothing written (add --write)')
    return
  }
  // Back into the dataset's own order (dated first, then most pressed).
  pool.countries[item.country] = [...list, item.movedRecord].sort(byDatedThenPressed)
  writeFileSync(POOL_PATH, `${JSON.stringify(pool, null, 2)}\n`)
  writeFileSync(
    HELD_PATH,
    `${JSON.stringify(
      {
        ...held,
        generatedAt: new Date().toISOString().slice(0, 10),
        cases: held.cases.filter((entry) => entry !== item),
        released: [
          ...(held.released ?? []),
          { caseKey: key, country: item.country, name: item.name, releasedOn: new Date().toISOString().slice(0, 10), because: BECAUSE },
        ],
      },
      null,
      1,
    )}\n`,
  )
}

if (RELEASE) release(RELEASE)
else hold()
