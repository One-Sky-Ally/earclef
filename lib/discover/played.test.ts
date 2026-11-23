/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/played.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PLAYED, sanitizeMarks } from './played.ts'

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
