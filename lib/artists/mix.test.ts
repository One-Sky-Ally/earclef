/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/artists/mix.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mixRows, shuffle } from './mix.ts'

test('shuffle keeps every item exactly once and leaves the input alone', () => {
  const input = Array.from({ length: 131 }, (_, i) => `artist-${i}`)
  const copy = [...input]
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const output = shuffle(input, random)
  assert.deepEqual(input, copy)
  assert.equal(output.length, input.length)
  assert.deepEqual([...output].sort(), [...input].sort())
  assert.notDeepEqual(output, input)
})

test('shuffle reaches every position for the first item', () => {
  const seen = new Set<number>()
  for (let run = 0; run < 400; run++) {
    seen.add(shuffle(['a', 'b', 'c', 'd'], Math.random).indexOf('a'))
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3])
})

test('the whole roster splits into four near-equal rows, order kept', () => {
  const input = Array.from({ length: 131 }, (_, i) => i)
  const rows = mixRows(input)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((row) => row.length), [33, 33, 33, 32])
  assert.deepEqual(rows.flat(), input)
})

test('a short list stays one row; nothing makes no rows', () => {
  assert.deepEqual(mixRows([1, 2, 3]), [[1, 2, 3]])
  assert.equal(mixRows(Array.from({ length: 30 }, (_, i) => i)).length, 2)
  assert.deepEqual(mixRows([]), [])
})
