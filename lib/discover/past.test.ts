/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/past.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectPastPicks, ownerPastDays, sharedPastDays } from './past.ts'
import type { DiscoverPick } from './types.ts'

const pick = (mbid: string, name = mbid): DiscoverPick => ({
  name,
  why: '',
  knownFor: '',
  knownForVerified: true,
  mbid,
  play: null,
  read: { kind: 'musicbrainz', url: `https://musicbrainz.org/artist/${mbid}` },
  listenHref: `https://musicbrainz.org/artist/${mbid}`,
  song: { videoId: 'aaaaaaaaaaa', title: 't', kind: 'audio' } as DiscoverPick['song'],
  bandcamp: null,
})

test('shared: only days up to today, newest first, future stock left out', () => {
  const index = { startDate: '2026-11-01', days: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }] }
  assert.deepEqual(
    sharedPastDays(index, '2026-11-03').map((d) => [d.date, d.id]),
    [
      ['2026-11-03', 's3'],
      ['2026-11-02', 's2'],
      ['2026-11-01', 's1'],
    ],
  )
})

test('shared: days past the stock show the archive repeats that were shown', () => {
  const index = { startDate: '2026-11-01', days: [{ id: 's1' }, { id: 's2' }] }
  assert.deepEqual(
    sharedPastDays(index, '2026-11-04').map((d) => d.id),
    ['s2', 's1', 's2', 's1'],
  )
})

test('shared: nothing before the index starts, nothing without an index', () => {
  assert.deepEqual(sharedPastDays({ startDate: '2026-11-05', days: [{ id: 's1' }] }, '2026-11-04'), [])
  assert.deepEqual(sharedPastDays(null, '2026-11-04'), [])
})

test('owner: current plus seen, newest first, never the unseen queue', () => {
  const index = {
    queue: ['q1', 'q2'],
    current: { date: '2026-11-10', id: 'o3' },
    seen: [
      { date: '2026-11-08', id: 'o2' },
      { date: '2026-11-02', id: 'o1' },
    ],
  }
  assert.deepEqual(
    ownerPastDays(index, '2026-11-10').map((d) => d.id),
    ['o3', 'o2', 'o1'],
  )
  assert.deepEqual(ownerPastDays(null, '2026-11-10'), [])
})

test('collect: one entry per artist, newest first, first and last dates, both sources', () => {
  const days = [
    { date: '2026-11-01', id: 'a', source: 'shared' as const },
    { date: '2026-11-03', id: 'b', source: 'shared' as const },
    { date: '2026-11-02', id: 'c', source: 'own' as const },
  ]
  const sets = new Map([
    ['a', [pick('x', 'X old'), pick('y')]],
    ['b', [pick('x', 'X new')]],
    ['c', [pick('y'), pick('z')]],
  ])
  const past = collectPastPicks(days, sets)
  assert.deepEqual(
    past.map((p) => [p.pick.mbid, p.pick.name, p.firstDate, p.lastDate, p.sources.join('+')]),
    [
      ['x', 'X new', '2026-11-01', '2026-11-03', 'shared'],
      ['y', 'y', '2026-11-01', '2026-11-02', 'own+shared'],
      ['z', 'z', '2026-11-02', '2026-11-02', 'own'],
    ],
  )
})

test('collect: a set that no longer exists is skipped', () => {
  const past = collectPastPicks([{ date: '2026-11-01', id: 'gone', source: 'shared' }], new Map())
  assert.deepEqual(past, [])
})
