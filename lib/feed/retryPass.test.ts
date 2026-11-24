/**
 * The second try: artists MusicBrainz did not answer for are asked again
 * at the end of the build (Nov 24, 2026).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/retryPass.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIsDone, inRetryPass, noteForRetry, replaceArtistReleases } from './retryPass.ts'
import type { SnapshotItem } from './snapshot.ts'

const row = (slug: string, title: string, type: SnapshotItem['type'] = 'release'): SnapshotItem =>
  ({ type, slug, artistName: slug, title, date: '2026-10-16', image: '', href: '' }) as SnapshotItem

test('the build is done only when the roster is walked and nobody waits for a second try', () => {
  assert.equal(buildIsDone({ cursor: 120 }, 131), false)
  assert.equal(buildIsDone({ cursor: 131 }, 131), true)
  assert.equal(buildIsDone({ cursor: 131, retry: [] }, 131), true)
  assert.equal(buildIsDone({ cursor: 131, retry: ['bob-dylan'] }, 131), false)
  assert.equal(inRetryPass({ cursor: 131, retry: ['bob-dylan'] }, 131), true)
  assert.equal(inRetryPass({ cursor: 30, retry: ['bob-dylan'] }, 131), false)
})

test('an artist is noted once, in order', () => {
  assert.deepEqual(noteForRetry(undefined, 'bob-dylan'), ['bob-dylan'])
  assert.deepEqual(noteForRetry(['bob-dylan'], 'michael-kiwanuka'), ['bob-dylan', 'michael-kiwanuka'])
  assert.deepEqual(noteForRetry(['bob-dylan'], 'bob-dylan'), ['bob-dylan'])
})

test("a full second answer replaces only that artist's release rows", () => {
  const items = [
    row('michael-kiwanuka', 'FUDGE'),
    row('michael-kiwanuka', 'clip', 'video'),
    row('imogen-heap', 'Chapter 4'),
  ]
  const fresh = [row('michael-kiwanuka', 'FUDGE'), row('michael-kiwanuka', 'Sing'), row('michael-kiwanuka', 'Summer Clothes')]
  const out = replaceArtistReleases(items, 'michael-kiwanuka', fresh)
  assert.deepEqual(
    out.map((item) => `${item.slug}/${item.type}/${item.title}`).sort(),
    [
      'imogen-heap/release/Chapter 4',
      'michael-kiwanuka/release/FUDGE',
      'michael-kiwanuka/release/Sing',
      'michael-kiwanuka/release/Summer Clothes',
      'michael-kiwanuka/video/clip',
    ],
  )
  assert.equal(items.length, 3, 'the input is not changed')
})
