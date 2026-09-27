/**
 * Occupation-filter fix (Sep 2026): the shared occupation lists, the
 * Wikidata pass's query and row handling, the owner-ruled gate, the
 * both-sides-present name check, the fetch timeout and the no-removal
 * guard — run with:
 *   node --test scripts/test/*.test.mjs
 *
 * The Sep 21 probe's own lists file is the reference: the explicit
 * allowlist must reproduce its buckets artist by artist. Nothing here
 * calls the network (the fetch tests use a local server).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  EXCLUDED_P106,
  LEGACY_P106,
  LEGACY_P31,
  OWNER_RULED_P106,
  PERFORMER_P106,
  PERFORMER_P31,
  SPOKEN_WORD,
  classifyOccupations,
  isMusicalProfession,
  passesLegacyFilter,
} from '../lib/musicOccupations.mjs'
import {
  collectWikidataRows,
  ownerRuledDecision,
  wikidataQuery,
} from '../lib/gapFillWikidata.mjs'
import { sameName } from '../lib/normalizeName.mjs'
import { getJson } from '../lib/fetchJson.mjs'
import { assertNothingRemoved, mergeIntoCommitted } from '../lib/gapFillMerge.mjs'

const lists = JSON.parse(
  readFileSync(new URL('../../data/occupation-filter-lists.json', import.meta.url), 'utf8'),
)
const bucketItems = (bucket) =>
  Object.values(lists.countries).flatMap((country) => country[bucket])

// ------------------------------------------------------------ the lists

test('the performer allowlist is exactly the legacy five plus the Sep 21 performer classes', () => {
  const ruledOrExcluded = new Set([...lists.excludedClasses, ...lists.ownerRuledClasses])
  const probeP106 = new Set(LEGACY_P106)
  const probeP31 = new Set(LEGACY_P31)
  for (const item of bucketItems('performer')) {
    for (const tagged of item.classes) {
      const [via, qid] = tagged.split(':')
      if (ruledOrExcluded.has(qid)) continue
      ;(via === 'P106' ? probeP106 : probeP31).add(qid)
    }
  }
  assert.deepEqual([...PERFORMER_P106].sort(), [...probeP106].sort())
  assert.deepEqual([...PERFORMER_P31].sort(), [...probeP31].sort())
  assert.deepEqual([...OWNER_RULED_P106].sort(), [...lists.ownerRuledClasses].sort())
  assert.deepEqual([...EXCLUDED_P106].sort(), [...lists.excludedClasses].sort())
})

test('no class is on two lists', () => {
  for (const qid of PERFORMER_P106) {
    assert.ok(!OWNER_RULED_P106.has(qid), `${qid} performer and owner-ruled`)
    assert.ok(!EXCLUDED_P106.has(qid), `${qid} performer and excluded`)
  }
  for (const qid of OWNER_RULED_P106) assert.ok(!EXCLUDED_P106.has(qid), `${qid} owner-ruled and excluded`)
})

test('every artist in the Sep 21 lists lands in the same bucket (828 / 114 / 320)', () => {
  const counts = { performer: 0, ownerRuled: 0, excluded: 0 }
  for (const bucket of Object.keys(counts)) {
    for (const item of bucketItems(bucket)) {
      const got = classifyOccupations(item.classes)
      assert.equal(got ?? 'excluded', bucket, `${item.wikidataId} ${item.name}`)
      counts[bucket]++
    }
  }
  assert.deepEqual(counts, { performer: 828, ownerRuled: 114, excluded: 320 })
})

test('everyone the old exact filter admitted is still admitted as a performer', () => {
  for (const qid of LEGACY_P106) {
    assert.equal(classifyOccupations([`P106:${qid}`]), 'performer')
    // …even alongside an excluded or owner-ruled class.
    assert.equal(classifyOccupations([`P106:Q753110`, `P106:${qid}`]), 'performer')
    assert.equal(classifyOccupations([`P106:Q158852`, `P106:${qid}`]), 'performer')
    assert.ok(passesLegacyFilter([`P106:${qid}`]))
  }
  for (const qid of LEGACY_P31) assert.equal(classifyOccupations([`P31:${qid}`]), 'performer')
})

test('admission needs a present, listed class — absent or unlisted is never a pass', () => {
  assert.equal(classifyOccupations([]), null)
  assert.equal(classifyOccupations(undefined), null)
  assert.equal(classifyOccupations(['P106:Q1']), null) // unlisted
  assert.equal(classifyOccupations(['P106:Q753110']), null) // songwriter-only (the Yemen poets)
  assert.equal(classifyOccupations(['P106:Q3595924']), null) // qāriʾ
  assert.equal(classifyOccupations(['P106:Q3595924', 'P106:Q23037330', 'P106:Q625163']), null)
  // A class counts under its own property only.
  assert.equal(classifyOccupations(['P31:Q2252262']), null)
  assert.equal(classifyOccupations(['P106:Q215380']), null)
  assert.equal(classifyOccupations(['Q2252262', '', ':', 'P106:']), null)
})

test('owner-ruled classes alone are ownerRuled; any performer class wins', () => {
  assert.equal(classifyOccupations(['P106:Q158852']), 'ownerRuled') // conductor
  assert.equal(classifyOccupations(['P106:Q183945', 'P106:Q753110']), 'ownerRuled') // producer + songwriter
  assert.equal(classifyOccupations([`P106:${SPOKEN_WORD}`]), 'ownerRuled')
  assert.equal(classifyOccupations(['P106:Q158852', 'P106:Q486748']), 'performer') // conductor + pianist
})

test('the held-rerun musician evidence flag never narrows from the retired 12-QID list', () => {
  const retired = [
    'Q639669', 'Q177220', 'Q36834', 'Q488205', 'Q855091', 'Q2252262',
    'Q753110', 'Q158852', 'Q183945', 'Q128124', 'Q1259917', 'Q806349',
  ]
  for (const qid of retired) assert.ok(isMusicalProfession(qid), qid)
  assert.ok(isMusicalProfession('Q2865819')) // opera singer, newly counted
  assert.ok(!isMusicalProfession('Q3595924')) // qāriʾ
  assert.ok(!isMusicalProfession('Q1'))
})

// ------------------------------------------------------ the Wikidata pass

test('the query matches listed classes exactly — no subclass walk, no excluded class', () => {
  const query = wikidataQuery('Q733', 'en')
  assert.ok(!query.includes('P279'), 'no P279 walk')
  for (const qid of [...PERFORMER_P106, ...OWNER_RULED_P106, ...PERFORMER_P31]) {
    assert.ok(query.includes(`wd:${qid} `) || query.includes(`wd:${qid} }`), qid)
  }
  for (const qid of EXCLUDED_P106) assert.ok(!query.includes(`wd:${qid}`), qid)
  assert.ok(query.includes('wd:Q733'))
})

const uri = (qid) => ({ value: `http://www.wikidata.org/entity/${qid}` })
const lit = (value) => ({ value })
const row = (fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) =>
      [key, /^Q\d+$/.test(value) && !key.endsWith('Label') ? uri(value) : lit(value)],
    ),
  )

test('rows union per item, tag each class, keep labels, and drop unlabelled items', () => {
  const people = collectWikidataRows([
    row({ item: 'Q10', itemLabel: 'Rapper One', occ: 'Q2252262', occLabel: 'rapper', citizen: 'Q733', birth: '1990-01-01T00:00:00Z' }),
    row({ item: 'Q10', itemLabel: 'Rapper One', occ: 'Q130857', occLabel: 'disc jockey', citizen: 'Q155' }),
    row({ item: 'Q11', itemLabel: 'Q11', occ: 'Q2252262' }), // unlabelled
    row({ item: 'Q12', itemLabel: 'Some Band', grp: 'Q5741069', formed: '1971-01-01T00:00:00Z', discogs: '123' }),
    row({ item: 'Q13', itemLabel: 'Maestro', occ: 'Q158852', mbid: 'aaaaaaaa-0000-4000-8000-000000000001' }),
    row({ item: 'Q14', itemLabel: 'Unlisted', occ: 'Q1' }),
  ])
  const byId = Object.fromEntries(people.map((person) => [person.wikidataId, person]))
  assert.deepEqual(Object.keys(byId).sort(), ['Q10', 'Q12', 'Q13'])
  assert.deepEqual([...byId.Q10.occupations].sort(), ['P106:Q130857', 'P106:Q2252262'])
  assert.deepEqual([...byId.Q10.citizenships].sort(), ['Q155', 'Q733'])
  assert.equal(byId.Q10.year, 2005)
  assert.equal(byId.Q10.admission, 'performer')
  assert.equal(byId.Q10.occupationLabels['P106:Q2252262'], 'rapper')
  assert.equal(byId.Q12.admission, 'performer')
  assert.equal(byId.Q12.year, 1971)
  assert.equal(byId.Q12.discogsId, '123')
  assert.equal(byId.Q13.admission, 'ownerRuled')
  assert.equal(byId.Q13.mbid, 'aaaaaaaa-0000-4000-8000-000000000001')
})

// ------------------------------------------------- the owner-ruled gate

const conductor = (extra = {}) => ({ occupations: ['P106:Q158852'], discogsId: '555', ...extra })

test('owner-ruled: a main credit tied by Discogs id admits', () => {
  assert.deepEqual(ownerRuledDecision(conductor(), { creditedInSweep: true }), {
    decision: 'admit',
    basis: 'discogs-main-credit-in-sweep',
  })
  assert.equal(
    ownerRuledDecision(conductor(), { mainCreditRefs: [{ releaseId: 1, kind: 'm' }] }).decision,
    'admit',
  )
})

test('owner-ruled: no evidence is not a pass', () => {
  assert.equal(ownerRuledDecision(conductor()).decision, 'out')
  assert.equal(ownerRuledDecision(conductor(), { mainCreditRefs: [] }).decision, 'out')
  // Track or extra-artist credits are not a release credited to them as artist.
  assert.equal(
    ownerRuledDecision(conductor(), { mainCreditRefs: [{ releaseId: 1, kind: 't' }, { releaseId: 2, kind: 'x' }] }).decision,
    'out',
  )
  // No Discogs id: nothing ties any release to them, whatever is claimed.
  for (const discogsId of [null, undefined, '', '  ']) {
    const decided = ownerRuledDecision(conductor({ discogsId }), {
      creditedInSweep: true,
      mainCreditRefs: [{ releaseId: 1, kind: 'm' }],
    })
    assert.equal(decided.decision, 'out', String(discogsId))
  }
})

test('owner-ruled: spoken word is never admitted by code — held with a credit, out without', () => {
  const poet = { occupations: [`P106:${SPOKEN_WORD}`], discogsId: '777' }
  assert.equal(ownerRuledDecision(poet, { creditedInSweep: true }).decision, 'held')
  assert.equal(ownerRuledDecision(poet, { mainCreditRefs: [{ releaseId: 1, kind: 'm' }] }).decision, 'held')
  assert.equal(ownerRuledDecision(poet).decision, 'out')
  assert.equal(ownerRuledDecision({ ...poet, discogsId: null }).decision, 'out')
  // Spoken word alongside another owner-ruled class follows that class.
  const both = { occupations: [`P106:${SPOKEN_WORD}`, 'P106:Q183945'], discogsId: '777' }
  assert.equal(ownerRuledDecision(both, { creditedInSweep: true }).decision, 'admit')
})

// ------------------------------------------------------ name equality

test('sameName: an empty key never matches, even against itself', () => {
  assert.equal(sameName('Los Jokers', 'LOS JOKERS!'), true)
  assert.equal(sameName('', ''), false)
  assert.equal(sameName('★', '☆'), false) // both normalize to ''
  assert.equal(sameName('—', ''), false)
  assert.equal(sameName(null, undefined), false)
  assert.equal(sameName('ຄຳພູ', 'ຄຳພູ'), true)
})

// ------------------------------------------------------------ getJson

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    return await run(url)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

const fast = { tries: 3, timeoutMs: 300, backoffMs: 0 }

test('getJson: a stalled server times out on every attempt and then throws', async () => {
  let hits = 0
  await withServer(
    () => {
      hits++ // never answers
    },
    async (url) => {
      const started = Date.now()
      await assert.rejects(getJson(url, {}, fast), /gave up after 3 tries/)
      assert.equal(hits, 3)
      assert.ok(Date.now() - started < 5000)
    },
  )
})

test('getJson: a body that stalls mid-stream counts as a failed attempt and is retried', async () => {
  let hits = 0
  await withServer(
    (req, res) => {
      hits++
      res.writeHead(200, { 'content-type': 'application/json' })
      if (hits === 1) {
        res.write('{"results": {"bindings": [') // …and never finishes
        return
      }
      res.end('{"ok": true}')
    },
    async (url) => {
      assert.deepEqual(await getJson(url, {}, fast), { ok: true })
      assert.equal(hits, 2)
    },
  )
})

test('getJson: a truncated body is retried, and throws when it never recovers', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"results": {"bindings": [')
    },
    async (url) => {
      await assert.rejects(getJson(url, {}, fast), /gave up after 3 tries/)
    },
  )
})

test('getJson: 503 then 200 succeeds; 404 is an error, never an empty answer', async () => {
  let hits = 0
  await withServer(
    (req, res) => {
      hits++
      if (req.url === '/missing') {
        res.writeHead(404)
        res.end()
        return
      }
      if (hits === 1) {
        res.writeHead(503)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"n": 1}')
    },
    async (url) => {
      assert.deepEqual(await getJson(url, {}, fast), { n: 1 })
      await assert.rejects(getJson(`${url}missing`, {}, fast), /HTTP 404/)
    },
  )
})

// ---------------------------------------------------- nobody is removed

const committedEntry = (name, extra = {}) => ({
  name,
  source: 'discogs',
  firstYear: 1970,
  lastYear: 1980,
  styles: ['Folk'],
  releaseCount: 3,
  discogsArtistId: null,
  wikidataId: null,
  ...extra,
})

test('top-up merge appends recovered artists and keeps every committed one', () => {
  const current = [
    committedEntry('Los Jokers', { discogsArtistId: 1, note: 'owner note' }),
    committedEntry('Purahéi Soul', { source: 'wikidata', wikidataId: 'Q109313870', discogsArtistId: 5037504 }),
    committedEntry('Idless Name'),
  ]
  const fresh = [
    committedEntry('Los Jokers', { discogsArtistId: 1, firstYear: 1965, releaseCount: 9 }),
    committedEntry('New Rapper', { source: 'wikidata', wikidataId: 'Q999', firstYear: null, releaseCount: 0, styles: [] }),
    committedEntry('LOS JOKERS', { discogsArtistId: 2 }), // name clash → skipped, not merged
  ]
  const merged = mergeIntoCommitted(current, fresh)
  assertNothingRemoved('PY', current, merged.list)
  assert.equal(merged.added, 1)
  assert.deepEqual(merged.addedNames, ['New Rapper'])
  assert.equal(merged.nameClash.length, 1)
  const jokers = merged.list.find((artist) => artist.discogsArtistId === 1)
  assert.equal(jokers.firstYear, 1965)
  assert.equal(jokers.note, 'owner note')
  assert.equal(merged.list.length, 4)
})

test('assertNothingRemoved throws, naming who would go, and counts duplicates', () => {
  const current = [committedEntry('A', { discogsArtistId: 1 }), committedEntry('B'), committedEntry('B')]
  assert.throws(
    () => assertNothingRemoved('PY', current, [committedEntry('A', { discogsArtistId: 1 }), committedEntry('B')]),
    /PY: 1 committed artist\(s\) would be removed \(B\)/,
  )
  assert.throws(() => assertNothingRemoved('PY', current, []), /3 committed/)
  // Widened fields are not identity.
  assertNothingRemoved('PY', current, [
    committedEntry('B', { releaseCount: 99 }),
    committedEntry('A', { discogsArtistId: 1, firstYear: 1901 }),
    committedEntry('B'),
    committedEntry('Extra'),
  ])
})
