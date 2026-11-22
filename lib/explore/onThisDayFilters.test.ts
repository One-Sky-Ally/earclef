import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FILTERS,
  applyFilters,
  filterOptions,
  filtersFromParams,
  filtersToParams,
  matchesYear,
} from './onThisDayFilters'

const items = [
  { id: 'a', y: 1965, c: 'GB', genres: ['rock', 'pop'] },
  { id: 'b', y: 1999, c: 'US', genres: ['jazz'] },
  { id: 'c', y: 1965, c: 'US', genres: ['rock'] },
  { id: 'd', y: 2012, c: 'JP', genres: [] },
  { id: 'e', y: 1968, c: 'GB', genres: ['soul'] },
]
const ids = (list: { id: string }[]) => list.map((item) => item.id).join('')
const name = (code: string) => ({ GB: 'United Kingdom', US: 'United States', JP: 'Japan' })[code] ?? code

test('oldest first keeps same-year releases in data order', () => {
  assert.equal(ids(applyFilters(items, DEFAULT_FILTERS)), 'acebd')
})

test('newest first reverses by year, same-year order unchanged', () => {
  assert.equal(ids(applyFilters(items, { ...DEFAULT_FILTERS, sort: 'newest' })), 'dbeac')
})

test('year values: one year, a decade, before 2000', () => {
  assert.ok(matchesYear(1965, '1965'))
  assert.ok(!matchesYear(1966, '1965'))
  assert.ok(matchesYear(1969, 'd1960') && !matchesYear(1970, 'd1960'))
  assert.ok(matchesYear(1999, 'pre2000') && !matchesYear(2000, 'pre2000'))
  assert.equal(ids(applyFilters(items, { ...DEFAULT_FILTERS, year: 'd1960' })), 'ace')
})

test('country and genre combine with year', () => {
  assert.equal(ids(applyFilters(items, { ...DEFAULT_FILTERS, country: 'US' })), 'cb')
  assert.equal(ids(applyFilters(items, { ...DEFAULT_FILTERS, genre: 'rock' })), 'ac')
  assert.equal(ids(applyFilters(items, { ...DEFAULT_FILTERS, genre: 'rock', country: 'GB' })), 'a')
  assert.equal(ids(applyFilters(items, { ...DEFAULT_FILTERS, genre: 'rock', year: 'pre2000', country: 'JP' })), '')
})

test('a release with no genres never matches a genre filter', () => {
  assert.ok(!applyFilters(items, { ...DEFAULT_FILTERS, genre: 'pop' }).some((item) => item.id === 'd'))
})

test('option counts follow the other filters', () => {
  const options = filterOptions(items, { ...DEFAULT_FILTERS, country: 'GB' }, name)
  // Genres counted among GB releases only.
  assert.deepEqual(
    options.genres.map((g) => `${g.value}:${g.count}`),
    ['pop:1', 'rock:1', 'soul:1'],
  )
  // Countries ignore the country filter itself, sorted by name.
  assert.deepEqual(options.countries.map((c) => `${c.value}:${c.count}`), ['JP:1', 'GB:2', 'US:2'])
  assert.deepEqual(
    options.decades.map((d) => `${d.decade.value}:${d.decade.count}`),
    ['d1960:2'],
  )
  assert.equal(options.pre2000, 2)
})

test('a chosen value missing from the day stays offered with 0', () => {
  const options = filterOptions(items, { ...DEFAULT_FILTERS, country: 'FR', genre: 'tango', year: '1950' }, name)
  assert.ok(options.countries.some((c) => c.value === 'FR' && c.count === 0))
  assert.ok(options.genres.some((g) => g.value === 'tango' && g.count === 0))
  assert.ok(options.decades.some((d) => d.decade.value === 'd1950' && d.years.some((y) => y.value === '1950')))
})

test('URL params round-trip and reject junk', () => {
  const filters = { sort: 'newest' as const, year: 'd1980', country: 'GB', genre: 'hip hop' }
  const params = filtersToParams(filters)
  assert.deepEqual(filtersFromParams((key) => params[key]), filters)
  assert.deepEqual(filtersToParams(DEFAULT_FILTERS), { sort: null, yr: null, loc: null, g: null })
  const junk = filtersFromParams((key) => ({ sort: 'sideways', yr: '19x5', loc: '<script>' })[key])
  assert.deepEqual(junk, DEFAULT_FILTERS)
})
