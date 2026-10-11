import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chapterLine,
  chapterPlaces,
  placesArtistIn,
  recordedLine,
  spanLabel,
  yearBounds,
  yearLabel,
  type Chapter,
} from './chapters.ts'

const based = (over: Partial<Chapter>): Chapter => ({
  kind: 'based',
  country: 'FR',
  countryName: 'France',
  source: 'test',
  ...over,
})

test('exact years bound themselves; decades bound their span', () => {
  assert.deepEqual(yearBounds(1985), [1985, 1985])
  assert.deepEqual(yearBounds('1930s'), [1930, 1939])
  assert.deepEqual(yearBounds('early-1980s'), [1980, 1983])
  assert.deepEqual(yearBounds('mid-1980s'), [1983, 1987])
  assert.deepEqual(yearBounds('late-1990s'), [1996, 1999])
})

test('year labels: exact years as is, decades shortened the way the owner wrote them', () => {
  assert.equal(yearLabel(1985), '1985')
  assert.equal(yearLabel('1930s'), '1930s')
  assert.equal(yearLabel('mid-1980s'), 'mid-80s')
  assert.equal(yearLabel('early-2000s'), 'early 2000s')
  assert.equal(yearLabel('late-1990s'), 'late 90s')
  assert.equal(yearLabel('early-1900s'), 'early 1900s')
})

test('span labels: tight dash for exact pairs, spaced for rough ones, since/until for one end, nothing when undated', () => {
  assert.equal(spanLabel(1985, 2002), '1985–2002')
  assert.equal(spanLabel('mid-1980s', 'early-2000s'), 'mid-80s – early 2000s')
  assert.equal(spanLabel('1930s', 1977), '1930s – 1977')
  assert.equal(spanLabel(1985, null), 'since 1985')
  assert.equal(spanLabel(null, 2002), 'until 2002')
  assert.equal(spanLabel(1984, 1984), '1984')
  assert.equal(spanLabel(null, null), '')
})

test('the chapter line: origin · place years, never "from", city when the source names one', () => {
  const line = chapterLine('Burkina Faso', [based({ place: 'Paris', from: 1985, to: 2002 })])
  assert.equal(line, 'Burkina Faso · Paris 1985–2002')
  assert.equal(
    chapterLine('Burkina Faso', [based({ place: 'Paris', from: 'mid-1980s', to: 'early-2000s' })]),
    'Burkina Faso · Paris mid-80s – early 2000s',
  )
  // No city on record → the country stands in.
  assert.equal(chapterLine('Afghanistan', [based({ country: 'US', countryName: 'United States' })]), 'Afghanistan · United States')
  // Several chapters, in the order given.
  assert.equal(
    chapterLine('Burkina Faso', [
      based({ place: 'Paris', from: 1985, to: 2002 }),
      based({ country: 'NG', countryName: 'Nigeria', place: 'Lagos', from: 2003 }),
    ]),
    'Burkina Faso · Paris 1985–2002 · Lagos since 2003',
  )
  assert.doesNotMatch(line ?? '', /\bfrom\b/)
})

test('recorded sessions are their own line and never part of the chapter line', () => {
  const chapters: Chapter[] = [
    based({ place: 'Paris', from: 1985, to: 2002 }),
    { kind: 'recorded', country: 'DK', countryName: 'Denmark', place: 'Copenhagen', from: 1984, to: 1984, source: 'test' },
    { kind: 'recorded', country: 'IT', countryName: 'Italy', place: 'Roma', from: 2014, to: 2014, source: 'test' },
  ]
  assert.equal(chapterLine('United States', chapters), 'United States · Paris 1985–2002')
  assert.equal(recordedLine(chapters), 'Recorded in Copenhagen 1984 · Roma 2014')
  assert.equal(recordedLine([based({})]), undefined)
  assert.equal(chapterLine('United States', [chapters[1]]), undefined)
})

test('a chapter places the artist in its country only when it is dated at the start and overlaps the span', () => {
  const dated = based({ from: 1985, to: 2002 })
  assert.equal(placesArtistIn(dated, 1990, 1995), true)
  assert.equal(placesArtistIn(dated, 2003, 2010), false)
  assert.equal(placesArtistIn(dated, 1970, 1985), true)
  // Open end: the source records a start and no end.
  assert.equal(placesArtistIn(based({ from: 1985 }), 2020, 2024), true)
  // …but never past the artist's own end when one is known.
  assert.equal(placesArtistIn(based({ from: 1889 }), 1975, 1975, 1924), false)
  assert.equal(placesArtistIn(based({ from: 1889 }), 1920, 1930, 1924), true)
  // A stated chapter end outranks the artist's end.
  assert.equal(placesArtistIn(based({ from: 1889, to: 1930 }), 1928, 1928, 1924), true)
  // Rough start gates on the decade reading, not an invented year.
  assert.equal(placesArtistIn(based({ from: 'mid-1980s', to: 1990 }), 1983, 1983), true)
  assert.equal(placesArtistIn(based({ from: 'mid-1980s', to: 1990 }), 1981, 1982), false)
  // Undated, or end-only, is a line on the home row only.
  assert.equal(placesArtistIn(based({}), 1990, 1995), false)
  assert.equal(placesArtistIn(based({ to: 2002 }), 1990, 1995), false)
  // Recorded sessions never place anyone.
  assert.equal(placesArtistIn({ ...dated, kind: 'recorded' }, 1990, 1995), false)
})

test('chapterPlaces lists the countries whose panels a dated chapter reaches, once each', () => {
  const chapters: Chapter[] = [
    based({ from: 1985, to: 2002 }),
    based({ country: 'FR', countryName: 'France', place: 'Lyon', from: 2003 }),
    based({ country: 'NG', countryName: 'Nigeria' }),
    { kind: 'recorded', country: 'DK', countryName: 'Denmark', from: 1984, to: 1984, source: 'test' },
  ]
  assert.deepEqual(chapterPlaces(chapters), ['FR'])
})
