/**
 * "Songs about this place" rules: category → globe place, roll-up to
 * the country, list-article exclusion, plain-record ranking.
 *   node --test scripts/test/songs-about-places.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyCategory,
  isListArticle,
  placeMaps,
  rankCandidates,
  servedUnder,
  versionOf,
} from '../lib/songsAboutPlaces.mjs'

const maps = placeMaps({
  codes: ['US', 'GB', 'FR', 'GE', 'JP', 'IE'],
  countryNames: { US: 'United States', GB: 'United Kingdom', FR: 'France', GE: 'Georgia', JP: 'Japan', IE: 'Ireland' },
  usStates: [{ code: 'US-GA', name: 'Georgia' }, { code: 'US-TX', name: 'Texas' }, { code: 'US-OK', name: 'Oklahoma' }],
  ukNations: [{ code: 'GB-ENG', name: 'England' }, { code: 'GB-SCT', name: 'Scotland' }],
  cities: ['FR|Paris', 'US|Houston'],
})

test('a country, a US state and a UK nation each map to their globe code', () => {
  assert.deepEqual(classifyCategory('Category:Songs about France', maps), { kind: 'country', key: 'FR', name: 'France', country: 'FR' })
  assert.deepEqual(classifyCategory('Category:Songs about Texas', maps), { kind: 'us-state', key: 'US-TX', name: 'Texas', country: 'US' })
  assert.deepEqual(classifyCategory('Category:Songs about Scotland', maps), { kind: 'uk-nation', key: 'GB-SCT', name: 'Scotland', country: 'GB' })
  assert.equal(classifyCategory('Category:Songs about the United States', maps).key, 'US')
})

test('the parenthetical is read first: Georgia (U.S. state) is the state, Georgia (country) the country', () => {
  assert.equal(classifyCategory('Category:Songs about Georgia (U.S. state)', maps).key, 'US-GA')
  assert.equal(classifyCategory('Category:Songs about Georgia (country)', maps).key, 'GE')
})

test('cities: chapter cities, known aliases, and "City, State" forms — each with a country', () => {
  assert.deepEqual(classifyCategory('Category:Songs about Paris', maps), { kind: 'city', key: 'FR|Paris', name: 'Paris', country: 'FR' })
  assert.equal(classifyCategory('Category:Songs about Tokyo', maps).country, 'JP')
  assert.deepEqual(classifyCategory('Category:Songs about Tulsa, Oklahoma', maps), { kind: 'city', key: 'US|Tulsa', name: 'Tulsa', country: 'US' })
  assert.equal(classifyCategory('Category:Songs about Houston, Texas', maps).key, 'US|Houston')
})

test('subjects the globe has no place for are null', () => {
  assert.equal(classifyCategory('Category:Songs about Donald Trump', maps), null)
  assert.equal(classifyCategory('Category:Songs about oceans and seas', maps), null)
  assert.equal(classifyCategory('Category:Songs about cities', maps), null)
  assert.equal(classifyCategory('Category:Songs by theme', maps), null)
})

test('a song is served under its place and its country, labelled by the place (owner, Oct 12)', () => {
  assert.deepEqual(servedUnder({ kind: 'city', key: 'FR|Paris', country: 'FR' }), ['FR|Paris', 'FR'])
  assert.deepEqual(servedUnder({ kind: 'us-state', key: 'US-TX', country: 'US' }), ['US-TX', 'US'])
  assert.deepEqual(servedUnder({ kind: 'country', key: 'FR', country: 'FR' }), ['FR'])
})

test('list articles are not songs', () => {
  assert.ok(isListArticle('List of songs about Paris'))
  assert.ok(!isListArticle('April in Paris (song)'))
})

test('versions are named from the annotation; remasters and official tags are not versions', () => {
  assert.equal(versionOf('calvin harris extended remix'), 'remix')
  assert.equal(versionOf('live at caesar s palace'), 'live')
  assert.equal(versionOf('official audio'), null)
  assert.equal(versionOf('remastered 2011'), null)
  assert.equal(versionOf(''), null)
})

test('the plain record outranks any version; then official video, audio, video', () => {
  const ranked = rankCandidates([
    { videoId: 'a', kind: 'official-video', version: 'live' },
    { videoId: 'b', kind: 'video', version: null },
    { videoId: 'c', kind: 'audio', version: null },
    { videoId: 'd', kind: 'official-video', version: null },
  ])
  assert.deepEqual(ranked.map((c) => c.videoId), ['d', 'c', 'b', 'a'])
})
