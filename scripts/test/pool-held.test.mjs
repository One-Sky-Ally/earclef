/**
 * Held pool entries must stay out of every later sweep — including
 * Wikidata-only entries, which have no Discogs id to key on (owner,
 * Oct 10 2026: "hold the three Uzbek ashiks until I've listened").
 *   node --test scripts/test/pool-held.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { heldPoolIds, isHeldInPool } from '../lib/originHeld.mjs'

function files(cases) {
  const dir = mkdtempSync(join(tmpdir(), 'held-'))
  const paths = {
    origin: join(dir, 'origin.json'),
    mbDuplicates: join(dir, 'mb.json'),
    occupation: join(dir, 'occupation.json'),
  }
  writeFileSync(paths.origin, JSON.stringify({ cases: cases.origin ?? [] }))
  writeFileSync(paths.mbDuplicates, JSON.stringify({ cases: cases.mb ?? [] }))
  writeFileSync(paths.occupation, JSON.stringify({ cases: cases.occupation ?? [] }))
  return paths
}

test('a Wikidata-only entry on the occupation held list is held in its pool only', () => {
  const held = heldPoolIds(files({ occupation: [{ country: 'UZ', wikidataId: 'Q126327433' }] }))
  const ashik = { name: 'Gʻulomjon Roʻziboyev', discogsArtistId: null, wikidataId: 'Q126327433' }
  assert.equal(isHeldInPool(held, 'UZ', ashik), true)
  assert.equal(isHeldInPool(held, 'KZ', ashik), false)
  assert.equal(isHeldInPool(held, 'UZ', { name: 'Other', discogsArtistId: null, wikidataId: 'Q1' }), false)
})

test('Discogs-keyed holds still work, and a missing id never matches', () => {
  const held = heldPoolIds(files({
    origin: [{ country: 'GH', discogsArtistId: 639889 }],
    mb: [{ country: 'MW', discogsArtistId: 42, moved: 'pool' }, { country: 'ET', discogsArtistId: 7, moved: 'mb' }],
  }))
  assert.equal(isHeldInPool(held, 'GH', { discogsArtistId: 639889 }), true)
  assert.equal(isHeldInPool(held, 'MW', { discogsArtistId: 42 }), true)
  assert.equal(isHeldInPool(held, 'ET', { discogsArtistId: 7 }), false)
  // Absent ids are not a match (standing lesson 5).
  assert.equal(isHeldInPool(held, 'GH', { discogsArtistId: null, wikidataId: null }), false)
})

test('only cases still on the list are held (a release moves a case out of `cases`)', () => {
  const held = heldPoolIds(files({ occupation: [{ country: 'UZ', wikidataId: 'Q126332003' }] }))
  assert.equal(isHeldInPool(held, 'UZ', { wikidataId: 'Q126331866' }), false)
  assert.equal(isHeldInPool(held, 'UZ', { wikidataId: 'Q126332003' }), true)
})

test('the default files load when no paths are given', () => {
  assert.ok(heldPoolIds() instanceof Map)
})
