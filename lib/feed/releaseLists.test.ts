/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/releaseLists.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECENT_DAYS,
  comingSoon,
  isUpcoming,
  recentlyReleased,
} from './releaseLists.ts'

const today = '2026-11-21'
const release = (title: string, date: string) => ({
  type: 'release' as const,
  title,
  date,
})
const video = (title: string, date: string) => ({
  type: 'video' as const,
  title,
  date,
})

const items = [
  release('Next month', '2026-12-12'),
  release('Tomorrow', '2026-11-22'),
  release('Today', '2026-11-21'),
  release('Last week', '2026-11-14'),
  release('Twenty-nine days ago', '2026-10-23'),
  release('Thirty days ago', '2026-10-22'),
  release('This month, no day', '2026-11'),
  release('Eight months ago', '2026-03-02'),
  release('364 days ago', '2025-11-22'),
  release('A year ago today', '2025-11-21'),
  video('A video today', '2026-11-21'),
  video('A video next week', '2026-11-28'),
]

test('isUpcoming: only releases dated after today', () => {
  assert.equal(isUpcoming(release('x', '2026-11-22'), today), true)
  assert.equal(isUpcoming(release('x', '2026-11-21'), today), false)
  // A full timestamp counts by its day.
  assert.equal(isUpcoming(release('x', '2026-11-21T23:00:00Z'), today), false)
  assert.equal(isUpcoming(video('x', '2026-11-28'), today), false)
})

test('comingSoon: future releases, soonest first, videos never', () => {
  assert.deepEqual(
    comingSoon(items, today).map((item) => item.title),
    ['Tomorrow', 'Next month'],
  )
})

test('recentlyReleased: the past year (today and the 364 before), newest first', () => {
  assert.equal(RECENT_DAYS, 365)
  assert.deepEqual(
    recentlyReleased(items, today).map((item) => item.title),
    [
      'Today',
      'Last week',
      'This month, no day',
      'Twenty-nine days ago',
      'Thirty days ago',
      'Eight months ago',
      '364 days ago',
    ],
  )
})

test('recentlyReleased: a 30-day window (the old default) still works', () => {
  assert.deepEqual(
    recentlyReleased(items, today, 30).map((item) => item.title),
    ['Today', 'Last week', 'This month, no day', 'Twenty-nine days ago'],
  )
})

test('recentlyReleased: a shorter window narrows it', () => {
  // A week is today and the six days before: Nov 14 is a day too old, and
  // a month-only date reads as that month's first day.
  assert.deepEqual(
    recentlyReleased(items, today, 8).map((item) => item.title),
    ['Today', 'Last week'],
  )
  assert.deepEqual(
    recentlyReleased(items, today, 7).map((item) => item.title),
    ['Today'],
  )
})

test('neither list changes the items passed in', () => {
  const copy = [...items]
  comingSoon(items, today)
  recentlyReleased(items, today)
  assert.deepEqual(items, copy)
})
