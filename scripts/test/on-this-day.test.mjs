/**
 * "On this day" (owner, Oct 10 2026): music released on a calendar day
 * in past years, from any country — ONLY exact release dates, and an
 * honest account when a day has little.
 *   node --test scripts/test/on-this-day.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correctedAway, exactDay, isOriginalMbGroup, selectDay } from '../lib/onThisDay.mjs'

test('only a real, exact day counts — never a year, a month, a placeholder Jan 1 or the future', () => {
  const today = '2026-10-10'
  assert.deepEqual(exactDay('1975-03-12', today), { year: 1975, monthDay: '03-12' })
  assert.equal(exactDay('1975', today), null)
  assert.equal(exactDay('1975-03', today), null)
  assert.equal(exactDay('1975-03-00', today), null)
  assert.equal(exactDay('1975-00-12', today), null)
  assert.equal(exactDay('1975-13-12', today), null)
  assert.equal(exactDay('1975-02-30', today), null)
  assert.equal(exactDay('1975-01-01', today), null)
  assert.equal(exactDay('2026-10-11', today), null)
  assert.equal(exactDay('1850-05-05', today), null)
  assert.deepEqual(exactDay('1976-02-29', today), { year: 1976, monthDay: '02-29' })
  assert.equal(exactDay('1975-02-29', today), null)
  assert.equal(exactDay(null, today), null)
})

test('an original group is an album, single or EP with no secondary type', () => {
  assert.equal(isOriginalMbGroup({ p: 'Album' }), true)
  assert.equal(isOriginalMbGroup({ p: 'Single', s: [] }), true)
  assert.equal(isOriginalMbGroup({ p: 'Album', s: ['Compilation'] }), false)
  assert.equal(isOriginalMbGroup({ p: 'Album', s: ['Live'] }), false)
  assert.equal(isOriginalMbGroup({ p: 'Other' }), false)
  assert.equal(isOriginalMbGroup({ p: undefined }), false)
})

test('an era-dating correction that disagrees with the year means the date is a reissue date', () => {
  const dating = { s: { 'ben hur': 1959 }, a: { 'rg-1': [1951, 1961] } }
  assert.equal(correctedAway({ i: 'rg-x', t: 'Ben-Hur' }, 1960, dating), true)
  assert.equal(correctedAway({ i: 'rg-x', t: 'Ben Hur' }, 1959, dating), false)
  assert.equal(correctedAway({ i: 'rg-1', t: 'Anything' }, 1995, dating), true)
  assert.equal(correctedAway({ i: 'rg-1', t: 'Anything' }, 1955, dating), false)
  assert.equal(correctedAway({ i: 'rg-2', t: 'Other' }, 1980, null), false)
})

const item = (year, country, weight, extra = {}) => ({ y: year, c: country, w: weight, t: `${country}${year}${weight}`, ...extra })

test('a day keeps a decade-balanced, country-diverse selection and counts everything', () => {
  const items = [
    ...Array.from({ length: 40 }, (_, n) => item(2020 + (n % 6), n % 2 ? 'US' : 'GB', 100 - n)),
    item(1964, 'JM', 3), item(1966, 'US', 50),
    ...Array.from({ length: 9 }, (_, n) => item(2015, 'US', 90 - n)),
    item(1985, 'GH', 1, { gapFill: true }),
  ]
  const day = selectDay(items, { perDecade: 6, perCountryInDecade: 3 })
  assert.equal(day.total, items.length)
  assert.equal(day.byDecade['1960'], 2)
  assert.equal(day.byDecade['2020'], 40)
  assert.equal(day.byCountry.JM, 1)
  // Old decades keep everything they have.
  assert.ok(day.items.some((entry) => entry.c === 'JM'))
  // No decade holds more than its quota; no country more than its share of it.
  const in2020 = day.items.filter((entry) => entry.y >= 2020)
  assert.equal(in2020.length, 6)
  assert.ok(in2020.filter((entry) => entry.c === 'US').length <= 3)
  // Gap-fill places are rare on the old record: always kept before 2000.
  assert.ok(day.items.some((entry) => entry.gapFill))
  // Chronological, oldest first.
  assert.deepEqual(day.items.map((entry) => entry.y), [...day.items.map((entry) => entry.y)].sort((a, b) => a - b))
})

test('an empty day is an honest zero', () => {
  assert.deepEqual(selectDay([], { perDecade: 6, perCountryInDecade: 3 }), { total: 0, byDecade: {}, byCountry: {}, items: [] })
})

test('after 2000 a decade is shared round-robin across countries, gap-fill or not — no flood', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, n) => item(2021, 'MD', 2, { gapFill: true, t: `md${n}` })),
    ...Array.from({ length: 10 }, (_, n) => item(2022, 'US', 90 - n)),
    ...Array.from({ length: 10 }, (_, n) => item(2023, 'JP', 80 - n)),
    item(2024, 'NG', 5),
  ]
  const day = selectDay(items, { perDecade: 8, perCountryInDecade: 3 })
  const counts = {}
  for (const entry of day.items) counts[entry.c] = (counts[entry.c] ?? 0) + 1
  assert.equal(day.items.length, 8)
  assert.deepEqual(Object.keys(counts).sort(), ['JP', 'MD', 'NG', 'US'])
  assert.ok(counts.MD <= 3)
})
