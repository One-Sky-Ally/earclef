/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/clipLength.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CLIP_SECONDS,
  dropShortClips,
  freshLengths,
  parseIsoDurationSeconds,
  settledLengths,
} from './clipLength.ts'

const video = (videoId: string, seconds?: number) => ({
  type: 'video' as const,
  videoId,
  title: videoId,
  ...(seconds === undefined ? {} : { seconds }),
})
const release = { type: 'release' as const, title: 'An album' }

test('parseIsoDurationSeconds: YouTube contentDetails durations', () => {
  assert.equal(parseIsoDurationSeconds('PT37S'), 37)
  assert.equal(parseIsoDurationSeconds('PT1M'), 60)
  assert.equal(parseIsoDurationSeconds('PT4M13S'), 253)
  assert.equal(parseIsoDurationSeconds('PT1H2M3S'), 3723)
  // Over a day: the days part counts (the play gates' parser drops it).
  assert.equal(parseIsoDurationSeconds('P1DT2H'), 93600)
  // Live and upcoming broadcasts carry no length yet.
  assert.equal(parseIsoDurationSeconds('P0D'), 0)
  assert.equal(parseIsoDurationSeconds(undefined), null)
  assert.equal(parseIsoDurationSeconds('not a duration'), null)
  assert.equal(parseIsoDurationSeconds(''), null)
})

test('dropShortClips: anything under a minute goes, a minute stays', () => {
  assert.equal(MIN_CLIP_SECONDS, 60)
  const kept = dropShortClips(
    [video('short', 37), video('minute', 60), video('long', 253), release],
    {},
  )
  assert.deepEqual(
    kept.map((item) => item.title),
    ['minute', 'long', 'An album'],
  )
})

test('dropShortClips: lengths learned at read time judge old snapshots', () => {
  // Snapshots stored before the rule carry no seconds: the lookup decides.
  const kept = dropShortClips([video('a'), video('b'), video('c')], {
    a: 13,
    b: 61,
  })
  // c is unknown (the lookup failed): kept, never dropped on a timeout.
  assert.deepEqual(
    kept.map((item) => item.title),
    ['b', 'c'],
  )
})

test('dropShortClips: a stamped length wins over the lookup', () => {
  const kept = dropShortClips([video('a', 200)], { a: 10 })
  assert.equal(kept.length, 1)
})

test('dropShortClips: a live or upcoming broadcast (no length yet) waits', () => {
  assert.equal(dropShortClips([video('premiere', 0)], {}).length, 0)
})

test('dropShortClips: does not change the items it keeps', () => {
  const items = [video('long', 300)]
  const kept = dropShortClips(items, {})
  assert.equal(kept[0], items[0])
})

test('freshLengths: YouTube facts are re-read within 30 days (Developer Policies III.E.4)', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z')
  const cache = {
    recent: { s: 200, at: '2026-11-01T00:00:00.000Z' },
    twentyEightDays: { s: 200, at: '2026-10-24T12:00:00.000Z' },
    thirtyDays: { s: 200, at: '2026-10-22T12:00:00.000Z' },
    old: { s: 200, at: '2026-08-01T00:00:00.000Z' },
    liveThreeHoursAgo: { s: 0, at: '2026-11-21T09:00:00.000Z' },
    liveSevenHoursAgo: { s: 0, at: '2026-11-21T05:00:00.000Z' },
  }
  assert.deepEqual(Object.keys(freshLengths(cache, now)).sort(), [
    'liveThreeHoursAgo',
    'recent',
    'twentyEightDays',
  ])
  // The cache passed in is left as it was.
  assert.equal(Object.keys(cache).length, 6)
})

test('settledLengths: the rebuild never judges a live or upcoming broadcast', () => {
  // A premiere at 15:00 UTC must not miss the night: left unstamped, the
  // read path judges it again once it has a length.
  const lengths = { premiere: 0, short: 37, long: 253 }
  assert.deepEqual(settledLengths(lengths), { short: 37, long: 253 })
  assert.equal(Object.keys(lengths).length, 3)
})
