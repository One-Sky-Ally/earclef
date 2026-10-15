/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/tiers.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FOLLOW_TIER, followTiers } from './tiers.ts'

test('an existing follow with no tier starts In the mix — nothing is dropped', () => {
  assert.equal(DEFAULT_FOLLOW_TIER, 'in-the-mix')
  assert.deepEqual(followTiers(['radiohead', 'bjork'], undefined), {
    radiohead: 'in-the-mix',
    bjork: 'in-the-mix',
  })
})

test("the fan's own choice wins; junk and unfollowed tiers are ignored", () => {
  assert.deepEqual(
    followTiers(['radiohead', 'bjork', 'aurora'], {
      radiohead: 'heavy-rotation',
      bjork: 'favourite',
      'not-followed': 'on-the-radar',
    }),
    { radiohead: 'heavy-rotation', bjork: 'in-the-mix', aurora: 'in-the-mix' },
  )
})
