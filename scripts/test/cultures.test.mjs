/**
 * Music cultures join rules (scripts/lib/cultures.mjs): a curated pick
 * plays only on an exact same-song, same-artist match to a video the
 * site already verified.
 *   node --test scripts/test/cultures.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEraJourneys,
  buildSongPlaces,
  plainStory,
  songKey,
  verifiedIndex,
  verifiedVideoFor,
} from '../lib/cultures.mjs'

const index = verifiedIndex({
  hitsPlay: {
    'billboard-hot-100|Aretha Franklin|Respect': { videoId: '_zv_Zoa-j2Q' },
    'uk-singles-chart|Blondie|Heart of Glass': { videoId: 'WGU_4-5RaxU', live: true },
  },
  songPlaces: {
    NG: {
      name: 'Nigeria',
      kind: 'country',
      songs: [
        { t: 'Zombie', a: 'Fela Kuti', v: 'RUSg31Ignw4', k: 'audio' },
        { t: 'Lagos', a: 'Someone', v: 'aaaaaaaaaaa', k: 'video', ver: 'live' },
      ],
    },
  },
  otdItems: [
    { n: 'George Harrison', t: 'My Sweet Lord', vs: 'My Sweet Lord', v: 'lttZj3oIht4' },
    { n: 'No Video', t: 'Silent' },
  ],
})

test('a chart pick joins the hits sweep only under its own chart', () => {
  assert.equal(verifiedVideoFor(index, 'US', 'Aretha Franklin', 'Respect')?.videoId, '_zv_Zoa-j2Q')
  assert.equal(verifiedVideoFor(index, 'US', 'Aretha Franklin', 'Respect')?.source, 'chart')
  // The same song named in a German era has no US-chart claim to lean on.
  assert.equal(verifiedVideoFor(index, 'DE', 'Aretha Franklin', 'Respect'), null)
  // A live verdict is carried, so the page can say so.
  assert.equal(verifiedVideoFor(index, 'GB', 'Blondie', 'Heart of Glass')?.live, true)
})

test('names compare case-, accent- and punctuation-insensitively', () => {
  assert.equal(verifiedVideoFor(index, 'NG', 'FELA KUTI', 'zombie')?.videoId, 'RUSg31Ignw4')
  assert.equal(verifiedVideoFor(index, 'DE', 'george harrison', 'My Sweet Lord!')?.source, 'on-this-day')
})

test('a different artist or a different song never joins', () => {
  assert.equal(verifiedVideoFor(index, 'NG', 'Fela Kuti', 'Water No Get Enemy'), null)
  assert.equal(verifiedVideoFor(index, 'NG', 'Femi Kuti', 'Zombie'), null)
})

test('a version (live, cover, remix) is a different recording and never joins', () => {
  assert.equal(verifiedVideoFor(index, 'NG', 'Someone', 'Lagos'), null)
})

test('missing is never a match (standing lesson 5)', () => {
  assert.equal(songKey('', 'Zombie'), null)
  assert.equal(songKey('★', '☆'), null)
  assert.equal(verifiedVideoFor(index, 'NG', '', ''), null)
})

test('era journeys keep unplayable picks, without a video', () => {
  const [era] = buildEraJourneys(
    [
      {
        country: 'NG',
        from: 1970,
        to: 1979,
        era: 'Afrobeat, juju, and highlife',
        kind: 'documented',
        basis: 'Documented scene history.',
        story: '[[Fela Kuti]] made the sound.',
        items: [
          { artist: 'Fela Kuti', work: 'Zombie', note: '1976' },
          { artist: 'King Sunny Adé', work: 'Synchro System' },
        ],
        sources: [],
      },
    ],
    index,
    () => 'Nigeria',
  )
  assert.equal(era.id, 'NG-1970-1979')
  assert.equal(era.summary, 'Fela Kuti made the sound.')
  assert.equal(era.playable, 1)
  assert.equal(era.thumb, 'RUSg31Ignw4')
  assert.equal(era.tracks[1].videoId, undefined)
  assert.equal(era.tracks[1].title, 'Synchro System')
})

test('song places skip malformed ids and rank by size', () => {
  const places = buildSongPlaces({
    FR: { name: 'France', kind: 'country', songs: [{ t: 'Paris', a: 'X', v: 'bbbbbbbbbbb', k: 'audio', y: 1990 }] },
    JP: {
      name: 'Japan',
      kind: 'country',
      songs: [
        { t: 'Tokyo', a: 'Y', v: 'ccccccccccc', k: 'audio', y: 1980 },
        { t: 'Kyoto', a: 'Z', v: 'ddddddddddd', k: 'official-video', y: 2001 },
        { t: 'Broken', a: 'Z', v: 'short', k: 'audio' },
      ],
    },
    XX: { name: 'Nowhere', kind: 'country', songs: [{ t: 'None', a: 'N', v: '' }] },
  })
  assert.deepEqual(places.map((place) => place.code), ['JP', 'FR'])
  assert.equal(places[0].count, 2)
  assert.equal(places[0].thumb, 'ddddddddddd')
  assert.equal(places[0].firstYear, 1980)
  assert.equal(places[0].lastYear, 2001)
})

test('plainStory strips listen-link markup only', () => {
  assert.equal(plainStory('When [[The Beatles]] hit [[US]] radio'), 'When The Beatles hit US radio')
})
