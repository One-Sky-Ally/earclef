/**
 * Local-source plumbing for dedup rule v3 — run with:
 *   node --test scripts/test/
 *
 * Fixtures are built in a temp dir and pointed at through the readers'
 * env overrides, so these never touch data/ and never call the network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const fixtures = mkdtempSync(join(tmpdir(), 'earclef-dedup-'))
process.env.EARCLEF_MB_DUMP_DIR = join(fixtures, 'mb')
process.env.EARCLEF_DISCOGS_INDEX_DIR = join(fixtures, 'dg')
delete process.env.EARCLEF_MB_SOURCE

const { normalizeName } = await import('../lib/normalizeName.mjs')
const { nameShardOf } = await import('../lib/mbNameIndex.mjs')

// --- MB fixtures ------------------------------------------------------
const PY = 'py-area-0000-0000-0000-000000000001'
const ASU = 'asu-area-000-0000-0000-000000000002'
const US = 'us-area-0000-0000-0000-000000000003'
mkdirSync(join(fixtures, 'mb', 'artist-names'), { recursive: true })
writeFileSync(
  join(fixtures, 'mb', 'area-parents.json'),
  JSON.stringify({
    snapshot: 'test',
    areas: {
      [PY]: ['Paraguay', 'Country', null, ['PY']],
      [ASU]: ['Asunción', 'City', PY],
      [US]: ['United States', 'Country', null, ['US']],
    },
  }),
)
const local = {
  id: 'a1a1a1a1-0000-4000-8000-000000000001',
  name: 'Los Jokers',
  type: 'Group',
  country: 'PY',
  area: { id: ASU, name: 'Asunción', type: 'City' },
  'begin-area': null,
  'life-span': { begin: '1964', end: null, ended: false },
  aliases: [{ name: 'Los Jokers (Paraguayos)', type: null }],
}
const foreign = {
  id: 'b2b2b2b2-0000-4000-8000-000000000002',
  name: 'The Jokers',
  type: 'Group',
  country: 'US',
  area: { id: US, name: 'United States', type: 'Country' },
  'begin-area': null,
  'life-span': { begin: '1958', end: '1970', ended: true },
  aliases: [{ name: 'Los Jokers', type: 'Artist name' }],
}
const key = normalizeName('Los Jokers')
writeFileSync(
  join(fixtures, 'mb', 'artist-names', `${nameShardOf(key)}.jsonl`),
  // Foreign first on disk: the reader's ordering must put the local one first.
  [{ k: key, r: foreign }, { k: key, r: local }]
    .map((row) => JSON.stringify(row))
    .join('\n') + '\n',
)
writeFileSync(
  join(fixtures, 'mb', 'artist-names-meta.json'),
  JSON.stringify({ complete: true, snapshot: 'test' }),
)

const rule = await import('../lib/dedup-rule.mjs')

test('normalizeName folds case, accents and punctuation but keeps non-Latin letters', () => {
  assert.equal(normalizeName('Ñandutí — Vol. 2!'), 'nanduti vol 2')
  assert.notEqual(normalizeName('ຄຳພູ ທະວິວັນ'), '')
  assert.notEqual(normalizeName('คาราบาว'), '')
  assert.equal(normalizeName('Café Tacvba'), normalizeName('CAFE TACVBA'))
  assert.equal(normalizeName(''), '')
  assert.equal(normalizeName(undefined), '')
})

test('nameShardOf is deterministic and two hex chars', () => {
  assert.equal(nameShardOf('los jokers'), nameShardOf('los jokers'))
  assert.match(nameShardOf('los jokers'), /^[0-9a-f]{2}$/)
  assert.match(nameShardOf('ຄາພູ'), /^[0-9a-f]{2}$/)
})

test('local sources are reported as live when the fixtures exist', () => {
  const sources = rule.dedupDataSources()
  assert.equal(sources.candidates, 'local')
  assert.equal(sources.areas, 'local')
})

test('exact-name candidates come back with the swept country first', async () => {
  const hits = await rule.searchMbArtists('Los Jokers', {
    country: 'PY',
    areaName: 'Paraguay',
  })
  assert.deepEqual(
    hits.map((artist) => artist.id),
    [local.id, foreign.id],
  )
  assert.equal(rule.exactNameHit(hits[0], 'Los Jokers'), 'name')
  assert.equal(rule.exactNameHit(hits[1], 'Los Jokers'), 'typed-alias')
  // Untyped alias never counts as a name (rule v3, point 4).
  assert.equal(rule.exactNameHit(local, 'Los Jokers (Paraguayos)'), null)
})

test('an empty probe never matches anything', async () => {
  assert.deepEqual(await rule.searchMbArtists(''), [])
  assert.deepEqual(await rule.searchMbArtists('   '), [])
})

test('area walk resolves through the parent chain, and unknown ids stay unknown', async () => {
  assert.equal(await rule.areaResolvesToCountry(ASU, 'Asunción', 'Paraguay'), 'match')
  assert.equal(await rule.areaResolvesToCountry(US, 'United States', 'Paraguay'), 'other')
  assert.equal(
    await rule.areaResolvesToCountry('zzzz-not-an-area', 'Nowhere', 'Paraguay'),
    'unknown',
  )
  assert.equal(await rule.areaResolvesToCountry(null, 'Paraguay', 'Paraguay'), 'match')
  assert.equal(await rule.areaResolvesToCountry(null, null, 'Paraguay'), 'unknown')
})

// --- judgeCandidate: every namesake weighed, strongest basis wins ----
test('judgeCandidate prefers record-level corroboration over an arbitrary first hit', async () => {
  mkdirSync(join(fixtures, 'mb', 'rg-by-artist'), { recursive: true })
  writeFileSync(join(fixtures, 'mb', 'index-meta.json'), JSON.stringify({ snapshot: 'test' }))
  // The US band has a release group titled "Sunny Beach"; the Paraguayan one has none.
  writeFileSync(
    join(fixtures, 'mb', 'rg-by-artist', 'b2.jsonl'),
    JSON.stringify({ a: foreign.id, i: 'rg-1', t: 'Sunny Beach', d: '1966', p: 'Album' }) + '\n',
  )
  const opts = { country: 'PY', areaName: 'Paraguay' }
  // No shared title: the Paraguayan namesake's area match (rank 1) beats
  // the US namesake's area contradiction (rank 4) → duplicate.
  const plain = await rule.judgeCandidate(
    { names: ['Los Jokers'], years: [1970], titles: new Set(['guarania nights']) },
    opts,
  )
  assert.equal(plain.verdict, 'duplicate')
  assert.equal(plain.basis, 'area')
  assert.equal(plain.mbid, local.id)
  assert.equal(plain.namesakes, 2)
  // A shared release title identifies the referent of THESE pressings:
  // the US band's record pressed in Paraguay → foreign-catalog wins.
  const shared = await rule.judgeCandidate(
    { names: ['Los Jokers'], years: [1970], titles: new Set(['sunny beach']) },
    opts,
  )
  assert.equal(shared.verdict, 'foreign-catalog')
  assert.equal(shared.basis, 'shared-title+foreign-area')
  assert.equal(shared.mbid, foreign.id)
  // No exact hit anywhere → null, the caller records 'new'.
  assert.equal(
    await rule.judgeCandidate({ names: ['Nobody Here'], years: [], titles: new Set() }, opts),
    null,
  )
})

// --- Discogs dump reader ---------------------------------------------
test('discogs reader refuses an incomplete index and expands a complete one', async () => {
  const dg = join(fixtures, 'dg')
  mkdirSync(join(dg, 'releases-by-country'), { recursive: true })
  writeFileSync(join(dg, 'releases-meta.json'), JSON.stringify({ complete: false }))
  writeFileSync(
    join(dg, 'countries.json'),
    JSON.stringify({ countries: { Paraguay: { slug: 'paraguay', total: 1 } } }),
  )
  const row = {
    i: 7984961,
    t: 'Slow Agony - Crumbling Empires',
    c: 'Paraguay',
    y: 2000,
    r: '2000',
    a: [{ i: 1210440, n: 'Nadainfinitum' }],
    l: [['Covenant Productions', 'CP-01']],
    f: ['CD'],
    fd: ['Album'],
    g: ['Rock'],
    s: ['Death Metal'],
    k: ['Intro', 'Crumbling Empires'],
  }
  writeFileSync(
    join(dg, 'releases-by-country', 'paraguay.jsonl.gz'),
    gzipSync(JSON.stringify(row) + '\n'),
  )
  const reader = await import('../lib/discogsDump.mjs')
  assert.equal(reader.releaseIndexAvailable(), false)
  assert.throws(() => reader.releasesFor('Paraguay'), /incomplete/)
  writeFileSync(join(dg, 'releases-meta.json'), JSON.stringify({ complete: true }))
  const releases = reader.releasesFor('Paraguay')
  assert.equal(releases.length, 1)
  assert.deepEqual(releases[0].artists, [{ id: 1210440, name: 'Nadainfinitum', anv: null }])
  assert.deepEqual(releases[0].labels, [{ name: 'Covenant Productions', catno: 'CP-01' }])
  assert.equal(releases[0].year, 2000)
  assert.deepEqual(releases[0].companies, [])
  assert.deepEqual(reader.releasesFor('Atlantis'), [])
})

test('plant slices match company names by prefix, whatever the role', async () => {
  const reader = await import('../lib/discogsDump.mjs')
  const slice = { country: 'USSR', label: 'Tashkent plant', pressedBy: ['Ташкентский Завод', 'Типография Ташкентского Завода'] }
  const tashkent = { companies: [{ name: 'Ташкентский Завод Грампластинок им. М. Т. Ташмухамедова', role: 'Pressed By' }] }
  const printShop = { companies: [{ name: 'Типография Ташкентского Завода Грампластинок', role: 'Printed By' }] }
  const riga = { companies: [{ name: 'Рижский Завод Грампластинок', role: 'Pressed By' }] }
  assert.equal(reader.plantMatches(tashkent, slice), true)
  assert.equal(reader.plantMatches(printShop, slice), true)
  assert.equal(reader.plantMatches(riga, slice), false)
  assert.equal(reader.plantMatches({ companies: [] }, slice), false)
  assert.equal(reader.plantMatches({}, slice), false)
})
