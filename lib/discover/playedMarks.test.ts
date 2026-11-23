/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/playedMarks.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PLAYED, mergeMarks, sanitizeMarks, withMark, withoutMark } from './playedMarks.ts'

const ID = '0a1b2c3d-0000-4000-8000-000000000001'

test('keeps well-formed marks and nothing else', () => {
  assert.deepEqual(
    sanitizeMarks({
      [ID]: { on: '2026-11-23', how: 'hand', extra: 'dropped' },
      'not-an-mbid': { on: '2026-11-23', how: 'play' },
      '0a1b2c3d-0000-4000-8000-000000000002': { on: 'yesterday' },
    }),
    { [ID]: { on: '2026-11-23', how: 'hand' } },
  )
})

test('an unknown "how" reads as a play', () => {
  assert.deepEqual(sanitizeMarks({ [ID]: { on: '2026-11-23', how: 'x' } }), {
    [ID]: { on: '2026-11-23', how: 'play' },
  })
})

test('junk is an empty list', () => {
  for (const junk of [null, 'x', 3, [], undefined]) assert.deepEqual(sanitizeMarks(junk), {})
})

test('bounded', () => {
  const many: Record<string, unknown> = {}
  for (let i = 0; i < MAX_PLAYED + 5; i++) {
    many[`0a1b2c3d-0000-4000-8000-${String(i).padStart(12, '0')}`] = { on: '2026-11-23' }
  }
  assert.equal(Object.keys(sanitizeMarks(many)).length, MAX_PLAYED)
})

const ID2 = '0a1b2c3d-0000-4000-8000-000000000002'

test('merge keeps both sides, and the earlier day where both have one', () => {
  const merged = mergeMarks(
    { [ID]: { on: '2026-11-20', how: 'play' } },
    { [ID]: { on: '2026-11-10', how: 'hand' }, [ID2]: { on: '2026-11-23', how: 'play' } },
  )
  assert.deepEqual(merged, {
    [ID]: { on: '2026-11-10', how: 'hand' },
    [ID2]: { on: '2026-11-23', how: 'play' },
  })
})

test('a second mark never moves the first one', () => {
  const once = withMark({}, ID, { on: '2026-11-01', how: 'play' })
  assert.deepEqual(withMark(once, ID, { on: '2026-11-23', how: 'hand' }), once)
  assert.deepEqual(withoutMark(once, ID), {})
})

test('when full, the oldest marks go first', () => {
  let marks = {}
  for (let i = 0; i < MAX_PLAYED; i++) {
    marks = { ...marks, [`0a1b2c3d-0000-4000-8000-${String(i).padStart(12, '0')}`]: { on: '2026-01-01', how: 'play' } }
  }
  const next = withMark(marks, ID2, { on: '2026-11-23', how: 'play' })
  assert.equal(Object.keys(next).length, MAX_PLAYED)
  assert.ok(next[ID2])
})
