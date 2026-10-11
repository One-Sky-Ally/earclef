/**
 * Where an "On this day" song was MADE (owner, Oct 11 2026): where it was
 * recorded — never where the artist was born, never where the record was
 * merely released. Only what is verified: a city when known, else just
 * the country, else nothing.
 *   node --test scripts/test/on-this-day-place.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agreedPlace, placeOfChain, songPlace } from '../lib/onThisDayPlace.mjs'

const area = (name, type, isoCodes = []) => ({ id: name, name, type, isoCodes })
const SYDNEY = [area('Sydney', 'City'), area('New South Wales', 'Subdivision'), area('Australia', 'Country', ['AU'])]
const BROOKLYN = [area('Brooklyn', 'District'), area('New York', 'City'), area('New York', 'Subdivision'), area('United States', 'Country', ['US'])]
const CALIFORNIA = [area('California', 'Subdivision'), area('United States', 'Country', ['US'])]
const LONDON = [area('London', 'City'), area('England', 'Subdivision'), area('United Kingdom', 'Country', ['GB'])]
const MANCHESTER = [area('Manchester', 'City'), area('England', 'Subdivision'), area('United Kingdom', 'Country', ['GB'])]
const SUBDIVISIONS = { US: { California: 'US-CA', 'New York': 'US-NY' }, GB: { England: 'GB-ENG' } }

test('a city and its country, with the globe subdivision where the site has one', () => {
  assert.deepEqual(placeOfChain(SYDNEY, SUBDIVISIONS), { city: 'Sydney', country: 'AU', countryName: 'Australia' })
  assert.deepEqual(placeOfChain(LONDON, SUBDIVISIONS), { city: 'London', country: 'GB', countryName: 'United Kingdom', sub: 'GB-ENG' })
})

test('a district resolves to its city; a state alone gives no city', () => {
  assert.deepEqual(placeOfChain(BROOKLYN, SUBDIVISIONS), { city: 'New York', country: 'US', countryName: 'United States', sub: 'US-NY' })
  assert.deepEqual(placeOfChain(CALIFORNIA, SUBDIVISIONS), { city: null, country: 'US', countryName: 'United States', sub: 'US-CA' })
})

test('no country in the chain is no place', () => {
  assert.equal(placeOfChain([area('Somewhere', 'City')], SUBDIVISIONS), null)
  assert.equal(placeOfChain([], SUBDIVISIONS), null)
})

test('places that disagree on the city keep only a shared country; different countries keep nothing', () => {
  const sydney = placeOfChain(SYDNEY, SUBDIVISIONS)
  const london = placeOfChain(LONDON, SUBDIVISIONS)
  const manchester = placeOfChain(MANCHESTER, SUBDIVISIONS)
  assert.deepEqual(agreedPlace([london, london]), london)
  assert.deepEqual(agreedPlace([london, manchester]), { city: null, country: 'GB', countryName: 'United Kingdom', sub: 'GB-ENG' })
  assert.equal(agreedPlace([london, sydney]), null)
  assert.equal(agreedPlace([]), null)
})

test('the song\'s own recording comes first; the whole release only when the song has nothing', () => {
  const sydney = placeOfChain(SYDNEY, SUBDIVISIONS)
  const london = placeOfChain(LONDON, SUBDIVISIONS)
  const group = { release: [london], tracks: { 'good vibrations': [sydney] } }
  assert.deepEqual(songPlace(group, 'Good Vibrations'), { ...sydney, basis: 'recording' })
  assert.deepEqual(songPlace(group, 'Heroes and Villains'), { ...london, basis: 'release' })
  assert.equal(songPlace({ release: [], tracks: {} }, 'Anything'), null)
  assert.equal(songPlace(undefined, 'Anything'), null)
})
