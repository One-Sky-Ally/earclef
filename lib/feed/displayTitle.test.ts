/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/displayTitle.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayTitle } from './displayTitle.ts'

test('hashtags leave the headline; the words stay', () => {
  assert.equal(displayTitle('Orange Juice #shorts #vegasmusic'), 'Orange Juice')
  assert.equal(displayTitle('#newmusic Golden Hour (Official Video)'), 'Golden Hour (Official Video)')
  assert.equal(displayTitle('Live at the Bunkhouse — #shorts'), 'Live at the Bunkhouse')
  assert.equal(displayTitle('Empress #TrustInTheSun #jazz #soul'), 'Empress')
})

test('chart positions and plain titles are untouched', () => {
  assert.equal(displayTitle('The #1 single, remastered'), 'The #1 single, remastered')
  assert.equal(displayTitle('Show Me How'), 'Show Me How')
})

test('a title that is only tags falls back to itself', () => {
  assert.equal(displayTitle('#shorts'), '#shorts')
})
