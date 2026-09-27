/**
 * End-to-end: the REAL gap-fill sweep (build-extra-artists.mjs) run
 * against fixtures — a committed pool, a work file whose Wikidata pass
 * was cached under the pre-fix filter, local Discogs/MB index stubs,
 * and a network stub that answers Wikidata from a fixture and fails
 * the run on any other host. Run with:
 *   node --test scripts/test/*.test.mjs
 *
 * Nothing here reads or writes the repo's data/ or lib/: each case
 * runs in its own temp dir.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(REPO, 'scripts/build-extra-artists.mjs')
const LISTS = JSON.parse(readFileSync(join(REPO, 'data/occupation-filter-lists.json'), 'utf8'))
const { OCCUPATION_FILTER_VERSION } = await import('../lib/musicOccupations.mjs')

/** Preloaded into the sweep: fixture Wikidata, empty Discogs search, nothing else. */
const NETWORK_STUB = `
import { appendFileSync, readFileSync } from 'node:fs'
const log = (entry) => appendFileSync(process.env.STUB_LOG, JSON.stringify(entry) + '\\n')
// Collapse the sweep's politeness delays; the timeout signal is untouched.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...rest)
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.host === 'query.wikidata.org') {
    log({ host: url.host, query: url.searchParams.get('query') })
    if (process.env.STUB_WDQS_FAIL) throw new TypeError('fetch failed (stub)')
    return new Response(readFileSync(process.env.STUB_WDQS_FIXTURE, 'utf8'), { status: 200 })
  }
  if (url.host === 'api.discogs.com' && url.pathname === '/database/search' && url.searchParams.get('type') === 'artist') {
    log({ host: url.host, q: url.searchParams.get('q') })
    return new Response('{"results": []}', { status: 200 })
  }
  log({ unexpected: String(input) })
  throw new Error('unexpected network call: ' + input)
}
`

const PY = 'Q733'
const uri = (qid) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` })
const lit = (value) => ({ type: 'literal', value })
const person = (id, label, cls, extra = {}) => {
  const [via, qid] = cls.split(':')
  return {
    item: uri(id),
    itemLabel: lit(label),
    citizen: uri(PY),
    ...(via === 'P106' ? { occ: uri(qid), occLabel: lit(`label of ${qid}`) } : { grp: uri(qid) }),
    ...Object.fromEntries(
      Object.entries(extra).map(([key, value]) => [key, key === 'mbid' || key === 'discogs' ? lit(value) : uri(value)]),
    ),
  }
}

const WDQS_ROWS = [
  person('Q100', 'Nuevo Rapero', 'P106:Q2252262'), // rapper — recovered performer
  person('Q101', 'Maestro Con Disco', 'P106:Q158852', { discogs: '2002' }), // conductor, credited on a PY release
  person('Q102', 'Director Sin Disco', 'P106:Q158852'), // conductor, no Discogs id
  person('Q103', 'Poeta Musical', 'P106:Q17378128', { discogs: '3003' }), // spoken word with a credit
  person('Q104', 'Productor Video', 'P106:Q183945', { discogs: '4004' }), // producer, main credit in the video index
  person('Q105', 'Arreglista Pista', 'P106:Q1643514', { discogs: '5005' }), // arranger, track credit only
  person('Q106', 'Poeta Yemen', 'P106:Q753110'), // songwriter-only: must never enter
  person('Q107', '★', 'P106:Q2252262'), // symbol-only label: normalizes to ''
  person('Q108', 'Los Jokers', 'P106:Q486748', { mbid: 'aaaaaaaa-0000-4000-8000-000000000001' }), // MB-known pianist
  person('Q109', 'Viejo Cantor', 'P106:Q177220'), // legacy class, already in the pool
  person('Q110', 'Rapero Extranjero', 'P106:Q2252262', { bornIn: 'Q155', citizen: 'Q155' }), // foreign by origin
]

const release = (id, artistId, name, title) => ({
  i: id, t: title, c: 'Paraguay', y: 1990, a: [{ i: artistId, n: name }], l: [['Label', 'X1']], g: ['Folk, World, & Country'], s: ['Folk'],
})

const COMMITTED = {
  generatedAt: '2026-09-01',
  countries: {
    PY: [
      { name: 'Los Jokers', source: 'discogs', firstYear: 1964, lastYear: 1990, styles: ['Folk'], releaseCount: 7, discogsArtistId: 1001, wikidataId: null, note: 'owner note' },
      { name: 'Viejo Cantor', source: 'wikidata', firstYear: 1950, lastYear: 1950, styles: [], releaseCount: 0, discogsArtistId: null, wikidataId: 'Q109' },
      { name: 'Retenido', source: 'discogs', firstYear: null, lastYear: null, styles: [], releaseCount: 1, discogsArtistId: 9009, wikidataId: null, retainedFrom: 'drift' },
    ],
    TD: [
      { name: 'Untouched', source: 'discogs', firstYear: 1970, lastYear: 1971, styles: [], releaseCount: 1, discogsArtistId: 7007, wikidataId: null },
    ],
  },
}

/** A work file as the pre-fix sweep left it: no stamp, old row shape. */
const STALE_WORK = {
  countries: {
    PY: {
      wikidata: [
        { wikidataId: 'Q109', name: 'Viejo Cantor', mbid: null, discogsId: null, year: 1950, bornIn: null, formedIn: null, citizenships: [PY] },
      ],
      releases: [],
      credits: {},
      verdicts: {
        'dg|1001': { verdict: 'new', basis: 'no-exact-hit' },
        'wd|Q109': { verdict: 'new', basis: 'no-exact-hit' },
      },
      artistIds: {},
    },
  },
}

function writeGzJsonl(path, rows) {
  writeFileSync(path, gzipSync(rows.map((row) => JSON.stringify(row)).join('\n') + '\n'))
}

const fixtureDirs = []
after(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true })
})

function fixture({ work = STALE_WORK } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'earclef-occsweep-'))
  fixtureDirs.push(dir)
  mkdirSync(join(dir, 'data/mb-dump/artist-names'), { recursive: true })
  mkdirSync(join(dir, 'data/discogs-dump/index/releases-by-country'), { recursive: true })
  mkdirSync(join(dir, 'data/discogs-dump/index/videos-by-artist'), { recursive: true })
  mkdirSync(join(dir, 'lib/explore'), { recursive: true })
  writeFileSync(join(dir, 'data/mb-dump/artist-names-meta.json'), JSON.stringify({ complete: true, snapshot: 'test' }))
  const index = join(dir, 'data/discogs-dump/index')
  writeFileSync(join(index, 'releases-meta.json'), JSON.stringify({ complete: true, source: 'test-dump', videosByArtist: true }))
  writeFileSync(join(index, 'countries.json'), JSON.stringify({ countries: { Paraguay: { slug: 'paraguay' } } }))
  writeGzJsonl(join(index, 'releases-by-country/paraguay.jsonl.gz'), [
    release(1, 1001, 'Los Jokers', 'Polca Paraguaya'),
    release(2, 2002, 'Maestro Con Disco', 'Sinfonía Guaraní'),
    release(3, 3003, 'Poeta Musical', 'Versos'),
    release(4, 6006, '☆☆', 'Estrellas'),
  ])
  const shard = (id) => (id % 256).toString(16).padStart(2, '0')
  writeGzJsonl(join(index, `videos-by-artist/${shard(4004)}.jsonl.gz`), [{ a: 4004, r: 44, k: 'm' }])
  writeGzJsonl(join(index, `videos-by-artist/${shard(5005)}.jsonl.gz`), [{ a: 5005, r: 55, k: 't' }])
  writeFileSync(join(dir, 'data/occupation-filter-lists.json'), JSON.stringify(LISTS))
  writeFileSync(join(dir, 'data/extra-artists-work-v2.json'), JSON.stringify(work))
  writeFileSync(join(dir, 'lib/explore/extra-artists.json'), JSON.stringify(COMMITTED, null, 2))
  writeFileSync(join(dir, 'wdqs.json'), JSON.stringify({ results: { bindings: WDQS_ROWS } }))
  writeFileSync(join(dir, 'stub.mjs'), NETWORK_STUB)
  return dir
}

function runSweep(dir, args, env = {}) {
  const result = spawnSync(process.execPath, ['--import', join(dir, 'stub.mjs'), SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      DISCOGS_TOKEN: 'test-token',
      EARCLEF_DISCOGS_INDEX_DIR: join(dir, 'data/discogs-dump/index'),
      EARCLEF_MB_DUMP_DIR: join(dir, 'data/mb-dump'),
      STUB_LOG: join(dir, 'network.log'),
      STUB_WDQS_FIXTURE: join(dir, 'wdqs.json'),
      ...env,
    },
  })
  const log = existsSync(join(dir, 'network.log'))
    ? readFileSync(join(dir, 'network.log'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  return { ...result, log }
}

const readJson = (dir, path) => JSON.parse(readFileSync(join(dir, path), 'utf8'))

test('a stale cached pass is refreshed and the fix takes effect — nobody committed is removed', () => {
  const dir = fixture()
  const run = runSweep(dir, ['PY'])
  assert.equal(run.status, 0, run.stderr + run.stdout)
  assert.deepEqual(run.log.filter((entry) => entry.unexpected), [])

  // Exactly one Wikidata query, with no subclass walk.
  const queries = run.log.filter((entry) => entry.host === 'query.wikidata.org')
  assert.equal(queries.length, 1)
  assert.ok(!queries[0].query.includes('P279'))

  const pool = readJson(dir, 'lib/explore/extra-artists.json')
  const py = pool.countries.PY
  const byName = (name) => py.find((artist) => artist.name === name)

  // Everyone committed is still there, owner state intact.
  for (const committed of COMMITTED.countries.PY) {
    const kept = py.find((artist) => artist.name === committed.name)
    assert.ok(kept, `${committed.name} kept`)
    assert.equal(kept.discogsArtistId, committed.discogsArtistId)
    assert.equal(kept.wikidataId, committed.wikidataId)
  }
  assert.equal(byName('Los Jokers').note, 'owner note')
  assert.equal(byName('Retenido').retainedFrom, 'drift')
  // Other countries are not touched.
  assert.deepEqual(pool.countries.TD, COMMITTED.countries.TD)

  // Recovered performer-class artist (rapper) enters, Wikidata-sourced.
  assert.equal(byName('Nuevo Rapero')?.wikidataId, 'Q100')
  // Owner-ruled with id-tied release evidence: in.
  assert.equal(byName('Productor Video')?.wikidataId, 'Q104')
  // Wikidata hands Discogs ids over as strings, as for the 227 already in the pool.
  assert.equal(String(byName('Productor Video')?.discogsArtistId), '4004')
  assert.equal(byName('Maestro Con Disco')?.wikidataId, 'Q101')
  // Owner-ruled without evidence, and songwriter-only: out.
  assert.equal(byName('Director Sin Disco'), undefined)
  assert.equal(byName('Arreglista Pista'), undefined)
  assert.equal(byName('Poeta Yemen'), undefined)
  assert.equal(byName('Rapero Extranjero'), undefined)
  // Spoken word is held: the Wikidata item is not linked (the Discogs
  // credit is its own, pre-existing path into the pool).
  assert.equal(byName('Poeta Musical')?.wikidataId, null)
  // A symbol-only label never matches another symbol-only name.
  assert.equal(byName('☆☆')?.wikidataId, null)
  assert.equal(byName('★')?.wikidataId, 'Q107')
  // No Discogs artist search was made for the empty-key name.
  assert.ok(!run.log.some((entry) => entry.q === '★'))
  assert.equal(py.length, COMMITTED.countries.PY.length + 6)

  // The cache is stamped; the owner-ruled decisions are on record.
  const work = readJson(dir, 'data/extra-artists-work-v2.json')
  assert.equal(work.countries.PY.wikidataFilter, OCCUPATION_FILTER_VERSION)
  const ruled = readJson(dir, 'data/occupation-owner-ruled-report.json')
  assert.deepEqual(ruled.ownerRuling, LISTS.ownerRuling)
  const decisions = Object.fromEntries(ruled.cases.map((entry) => [entry.wikidataId, entry.decision]))
  assert.deepEqual(decisions, { Q101: 'admit', Q102: 'out', Q103: 'held', Q104: 'admit', Q105: 'out' })
  assert.equal(ruled.cases.find((entry) => entry.wikidataId === 'Q103').discogsCandidate, true)
  assert.equal(ruled.cases.find((entry) => entry.wikidataId === 'Q104').discogsCandidate, false)
  const report = readJson(dir, 'data/extra-artists-report.json')
  assert.deepEqual(report.PY.occupationAdmission.ownerRuled, { admitted: 2, held: 1, leftOut: 2 })
  assert.equal(report.PY.occupationAdmission.classes['P106:Q2252262'].label, 'label of Q2252262')

  // A second run finds the stamp current and does not query again.
  const again = runSweep(dir, ['PY'])
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.log.filter((entry) => entry.host === 'query.wikidata.org').length, 1)
  assert.deepEqual(readJson(dir, 'lib/explore/extra-artists.json').countries.PY, py)
})

test('when Wikidata fails, the country is skipped and left exactly as committed', () => {
  const dir = fixture()
  const run = runSweep(dir, ['PY'], { STUB_WDQS_FAIL: '1' })
  assert.equal(run.status, 2, run.stderr + run.stdout)
  assert.match(run.stderr, /SKIPPED PY/)
  assert.match(run.stderr, /Retry: node scripts\/build-extra-artists\.mjs PY/)
  // Retried, bounded.
  assert.equal(run.log.filter((entry) => entry.host === 'query.wikidata.org').length, 4)
  assert.deepEqual(readJson(dir, 'lib/explore/extra-artists.json').countries, COMMITTED.countries)
  const work = readJson(dir, 'data/extra-artists-work-v2.json')
  assert.equal(work.countries.PY.wikidataFilter, undefined)
  assert.deepEqual(work.countries.PY.wikidata, STALE_WORK.countries.PY.wikidata)
  assert.ok(!existsSync(join(dir, 'data/occupation-owner-ruled-report.json')))
})

test('--replace is refused while a cached pass predates the filter', () => {
  const dir = fixture()
  const run = runSweep(dir, ['PY', '--replace'])
  assert.equal(run.status, 1)
  assert.match(run.stderr, /--replace refused: PY/)
  assert.equal(run.log.length, 0)
  assert.deepEqual(readJson(dir, 'lib/explore/extra-artists.json'), COMMITTED)
})
