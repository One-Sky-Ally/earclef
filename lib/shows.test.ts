/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/shows.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localIsoDate, splitShows } from './shows.ts'

const base = { enabled: true }

test('future dates stay upcoming, soonest first', () => {
  const split = splitShows(
    {
      ...base,
      upcoming: [
        { date: '2027-03-01', venue: 'B', city: 'Y' },
        { date: '2027-01-10', venue: 'A', city: 'X' },
      ],
      past: [],
    },
    '2026-11-23',
  )
  assert.deepEqual(
    split.upcoming.map((s) => s.venue),
    ['A', 'B'],
  )
  assert.equal(split.past.length, 0)
  assert.equal(split.noteStillHolds, true)
})

test('a show dated today still counts as upcoming', () => {
  const split = splitShows(
    { ...base, upcoming: [{ date: '2026-11-23', venue: 'A', city: 'X' }], past: [] },
    '2026-11-23',
  )
  assert.equal(split.upcoming.length, 1)
})

test('lapsed upcoming dates move to Past, newest first, and the stale note is dropped', () => {
  const split = splitShows(
    {
      ...base,
      upcomingNote: 'European dates below.',
      upcoming: [
        { date: '2026-07-14', venue: 'Lapsed', city: 'X', ticketUrl: 'https://t' },
      ],
      past: [{ date: '2025-05-01', venue: 'Old', city: 'Y', songs: ['One'] }],
    },
    '2026-11-23',
  )
  assert.equal(split.upcoming.length, 0)
  assert.deepEqual(
    split.past.map((s) => s.venue),
    ['Lapsed', 'Old'],
  )
  assert.equal('ticketUrl' in split.past[0], false)
  assert.equal(split.noteStillHolds, false)
})

test('a page that never had dates keeps its note', () => {
  const split = splitShows(
    { ...base, upcomingNote: 'Tour dates at example.com.', upcoming: [], past: [] },
    '2026-11-23',
  )
  assert.equal(split.noteStillHolds, true)
})

test('the same show is never listed twice', () => {
  const split = splitShows(
    {
      ...base,
      upcoming: [{ date: '2026-01-01', venue: 'A', city: 'X' }],
      past: [{ date: '2026-01-01', venue: 'A', city: 'X', setlistUrl: 'https://s' }],
    },
    '2026-11-23',
  )
  assert.equal(split.past.length, 1)
  assert.equal(split.past[0].setlistUrl, 'https://s')
})

test('localIsoDate pads month and day', () => {
  assert.equal(localIsoDate(new Date(2026, 0, 5)), '2026-01-05')
})
