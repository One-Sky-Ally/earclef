import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeDayFile, dayFilePath, releaseKey } from './onThisDayAll'
import { DEFAULT_FILTERS, applyFilters } from './onThisDayFilters'
import type { OnThisDayItem } from './onThisDay'

const MB = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3'

const file = {
  date: '11-22',
  countryNames: { GB: 'United Kingdom', GH: 'Ghana' },
  artists: [
    ['Queen', 'GB', MB, ['rock', 'british']],
    ['Gap Band', 'GH', null, ['highlife']],
  ],
  items: [
    [1965, 'Early Single', 'Single', 0, 0],
    [1975, 'Highlife Album', 'LP', 1, 4242],
    [2015, 'Late Album', 'Album', 0, 0],
    [2015, 'Late Album', 'Album', 0, 0],
  ],
}

const listed: OnThisDayItem = {
  y: 2015,
  t: 'Late Album',
  k: 'Album',
  c: 'GB',
  n: 'Queen',
  a: MB,
  genres: ['rock'],
  v: 'abcdefghijk',
  vs: 'Late Song',
}

test('the day file path', () => {
  assert.equal(dayFilePath('11-22'), '/data/on-this-day/11-22.json')
})

test('decodes every release, once, keeping the listed one with its verified video', () => {
  const items = decodeDayFile(file, '11-22', [listed])?.items
  assert.ok(items)
  assert.deepEqual(items.map((item) => item.t), ['Early Single', 'Highlife Album', 'Late Album'])
  assert.equal(items[2], listed)
  // A release only the day file has never gets a play button.
  assert.equal(items[0].v, undefined)
  assert.equal(items[0].a, MB)
  assert.equal(items[1].dg, 4242)
  assert.equal(items[1].a, undefined)
  assert.equal(items[1].c, 'GH')
  assert.equal(decodeDayFile(file, '11-22', [])?.countryNames.GH, 'Ghana')
})

test('a listed release the file lacks is kept, so filtering never hides it', () => {
  const extra: OnThisDayItem = { ...listed, y: 1970, t: 'Only Listed', v: undefined }
  const items = decodeDayFile(file, '11-22', [extra])?.items
  assert.ok(items)
  assert.ok(items.some((item) => releaseKey(item) === releaseKey(extra)))
  assert.deepEqual(items.map((item) => item.y), [1965, 1970, 1975, 2015])
})

test('a file for another day, or not a day file, is refused', () => {
  assert.equal(decodeDayFile(file, '11-23', []), null)
  assert.equal(decodeDayFile({ nope: true }, '11-22', []), null)
  assert.equal(decodeDayFile(null, '11-22', []), null)
})

test('filters reach every release of the day', () => {
  const items = decodeDayFile(file, '11-22', [listed])?.items
  assert.ok(items)
  const gh = applyFilters(items, { ...DEFAULT_FILTERS, country: 'GH' })
  assert.deepEqual(gh.map((item) => item.t), ['Highlife Album'])
  const rock = applyFilters(items, { ...DEFAULT_FILTERS, genre: 'rock', sort: 'newest' })
  assert.deepEqual(rock.map((item) => item.y), [2015, 1965])
})
