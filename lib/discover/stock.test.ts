/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/stock.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  appendOwner,
  appendShared,
  ownerSetFor,
  recentSharedIds,
  setsToAdd,
  sharedReady,
  sharedSetFor,
  sharedThrough,
  SHARED_KEEP_DAYS,
} from './stock.ts'

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

test('no stock means no shared set — the caller falls back, never shows an empty row', () => {
  assert.equal(sharedSetFor(null, '2026-10-20'), null)
})

test('the first fill starts today and runs one set a day', () => {
  const { index } = appendShared(null, ids('s', 14), '2026-10-20')
  assert.deepEqual(sharedSetFor(index, '2026-10-20'), { id: 's1', archive: false })
  assert.deepEqual(sharedSetFor(index, '2026-11-02'), { id: 's14', archive: false })
  assert.equal(sharedReady(index, '2026-10-20'), 13)
  assert.equal(sharedThrough(index), '2026-11-02')
})

test('run out → earlier sets come back oldest first, labelled from the archive', () => {
  const { index } = appendShared(null, ids('s', 3), '2026-10-20')
  assert.deepEqual(sharedSetFor(index, '2026-10-23'), { id: 's1', archive: true })
  assert.deepEqual(sharedSetFor(index, '2026-10-24'), { id: 's2', archive: true })
  assert.deepEqual(sharedSetFor(index, '2026-10-26'), { id: 's1', archive: true })
  assert.equal(sharedReady(index, '2026-10-25'), 0)
})

test('a refresh after a run-out keeps the archive days as shown and starts fresh sets today', () => {
  const first = appendShared(null, ids('s', 3), '2026-10-20').index
  // 2026-10-23 and -24 were served s1, s2 from the archive; today is the 25th.
  const shownOn24 = sharedSetFor(first, '2026-10-24')
  const { index } = appendShared(first, ['t1', 't2'], '2026-10-25')
  assert.deepEqual(sharedSetFor(index, '2026-10-24'), shownOn24)
  assert.deepEqual(sharedSetFor(index, '2026-10-25'), { id: 't1', archive: false })
  assert.deepEqual(sharedSetFor(index, '2026-10-26'), { id: 't2', archive: false })
})

test('a top-up before running out queues behind the sets already planned', () => {
  const first = appendShared(null, ids('s', 14), '2026-10-20').index
  const { index } = appendShared(first, ids('t', 14), '2026-10-27')
  assert.deepEqual(sharedSetFor(index, '2026-11-02'), { id: 's14', archive: false })
  assert.deepEqual(sharedSetFor(index, '2026-11-03'), { id: 't1', archive: false })
  assert.equal(sharedReady(index, '2026-10-27'), 20)
})

test('days older than the keep window are trimmed and their sets released', () => {
  const first = appendShared(null, ids('s', 100), '2026-01-01').index
  const today = addDays('2026-01-01', SHARED_KEEP_DAYS + 5)
  const { index, dropped } = appendShared(first, ['new'], today)
  assert.equal(index.startDate, addDays('2026-01-01', 5))
  assert.deepEqual(dropped, ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(sharedSetFor(index, today), { id: 's96', archive: false })
})

test('recent ids walk back from today, each set once', () => {
  const { index } = appendShared(null, ids('s', 2), '2026-10-20')
  assert.deepEqual(recentSharedIds(index, '2026-10-23', 14), ['s2', 's1'])
})

test('owner: a fresh set on the first visit of a day, the same set all day, nothing used on days away', () => {
  let index = appendOwner(null, ids('o', 3)).index
  const day1 = ownerSetFor(index, '2026-10-20')
  assert.equal(day1.id, 'o1')
  assert.equal(day1.changed, true)
  index = day1.index!
  const again = ownerSetFor(index, '2026-10-20')
  assert.equal(again.id, 'o1')
  assert.equal(again.changed, false)
  const later = ownerSetFor(index, '2026-10-27')
  assert.equal(later.id, 'o2')
  assert.deepEqual(later.index!.seen, [{ date: '2026-10-20', id: 'o1' }])
})

test('owner: when the list runs out there is no set (the page shows the shared picks)', () => {
  let index = appendOwner(null, ['o1']).index
  index = ownerSetFor(index, '2026-10-20').index!
  assert.equal(ownerSetFor(index, '2026-10-21').id, null)
  assert.equal(ownerSetFor(appendOwner(index, ['o2']).index, '2026-10-21').id, 'o2')
})

test('refresh sizes: about two weeks first, then growth toward the ceiling', () => {
  assert.equal(setsToAdd('shared', 0), 14)
  assert.equal(setsToAdd('shared', 7), 14)
  assert.equal(setsToAdd('shared', 53), 7)
  assert.equal(setsToAdd('shared', 60), 0)
  assert.equal(setsToAdd('owner', 0), 14)
  assert.equal(setsToAdd('owner', 20), 10)
})
