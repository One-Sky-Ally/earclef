/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/explore/rosterMatch.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterExact, rosterPartial, type RosterRow } from './rosterMatch.ts'

const ROWS: RosterRow[] = [
  { slug: 'trust-in-the-sun', name: 'Trust in the Sun', identity: 'A buttery Las Vegas fusion.' },
  { slug: 'amadou-mariam', name: 'Amadou & Mariam' },
  { slug: 'bjork', name: 'Björk' },
  { slug: 'cake', name: 'Cake' },
  { slug: 'can', name: 'Can' },
  { slug: 'the-decemberists', name: 'The Decemberists' },
]

test('the roster wins on its own name, whatever the case or spacing', () => {
  assert.equal(rosterExact(ROWS, 'Trust in the Sun')?.slug, 'trust-in-the-sun')
  assert.equal(rosterExact(ROWS, '  trust IN the sun ')?.slug, 'trust-in-the-sun')
  assert.equal(rosterExact(ROWS, 'Amadou and Mariam')?.slug, 'amadou-mariam')
  assert.equal(rosterExact(ROWS, 'bjork')?.slug, 'bjork')
  assert.equal(rosterExact(ROWS, 'Decemberists')?.slug, 'the-decemberists')
  assert.equal(rosterExact(ROWS, 'Trust in the Sun')?.identity, 'A buttery Las Vegas fusion.')
})

test('a place name is not a roster artist', () => {
  assert.equal(rosterExact(ROWS, 'Paraguay'), null)
  assert.equal(rosterExact(ROWS, 'Las Vegas'), null)
  assert.deepEqual(rosterPartial(ROWS, 'Paraguay'), [])
  assert.deepEqual(rosterPartial(ROWS, 'Canada'), [])
})

test('partial names are offered, never certain', () => {
  assert.equal(rosterExact(ROWS, 'trust in the'), null)
  assert.ok(rosterPartial(ROWS, 'trust in the').some((m) => m.slug === 'trust-in-the-sun'))
  assert.ok(rosterPartial(ROWS, 'sun trust').some((m) => m.slug === 'trust-in-the-sun'))
  assert.ok(rosterPartial(ROWS, 'the band cake').some((m) => m.slug === 'cake'))
  // The exact match is never ALSO a partial.
  assert.ok(!rosterPartial(ROWS, 'Trust in the Sun').some((m) => m.slug === 'trust-in-the-sun'))
  // Short fragments are noise, not a lead.
  assert.deepEqual(rosterPartial(ROWS, 'sun'), [])
})
