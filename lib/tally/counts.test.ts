import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addOne, isTallyKind, isTallySection, recentDays, sectionOf, sumDays } from './counts'

test('sections come from the first part of the path only', () => {
  assert.equal(sectionOf('/'), 'home')
  assert.equal(sectionOf('/feed'), 'feed')
  assert.equal(sectionOf('/explore?place=NZ'), 'explore')
  assert.equal(sectionOf('/on-this-day'), 'on-this-day')
  assert.equal(sectionOf('/radiohead'), 'artist')
  assert.equal(sectionOf('/a/0383dadf-2a4e-4d10-a46a-e9e041da8eb3'), 'archive-artist')
  assert.equal(sectionOf('/fan/abc123'), 'taste-map')
  assert.equal(sectionOf('/privacy'), 'other')
  assert.equal(sectionOf('/something/deeper'), 'other')
})

test('only known kinds and sections are accepted', () => {
  assert.ok(isTallyKind('play'))
  assert.ok(!isTallyKind('view'))
  assert.ok(!isTallyKind(42))
  assert.ok(isTallySection('feed'))
  assert.ok(!isTallySection('/feed'))
  assert.ok(!isTallySection('someone@example.com'))
})

test('adding one leaves the rest of the day alone', () => {
  const day = addOne(addOne({}, 'play', 'feed'), 'play', 'feed')
  assert.deepEqual(addOne(day, 'save', 'explore'), { 'play:feed': 2, 'save:explore': 1 })
})

test('days sum into a table, busiest section first, junk ignored', () => {
  const table = sumDays([
    { 'play:feed': 2, 'share:artist': 1 },
    { 'play:explore': 5, 'save:explore': 1, 'bogus:feed': 9, 'play:nowhere': 3 },
    { 'play:feed': 1, 'save:feed': -4 },
  ])
  assert.deepEqual(table.totals, { play: 8, save: 1, share: 1 })
  assert.deepEqual(
    table.rows.map((row) => row.section),
    ['explore', 'feed', 'artist'],
  )
})

test('recent days count back from today, newest first', () => {
  assert.deepEqual(recentDays(new Date('2026-03-01T12:00:00Z'), 3), [
    '2026-03-01',
    '2026-02-28',
    '2026-02-27',
  ])
})
