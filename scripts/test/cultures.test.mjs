/**
 * Music cultures rules (scripts/lib/cultures.mjs): a journey lists only
 * songs that play on the site (owner rule, Oct 14 2026); a pick plays
 * only on an exact same-song, same-artist match to a verified video.
 *   node --test scripts/test/cultures.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_JOURNEY_TRACKS,
  buildDecadeJourneys,
  buildEraJourneys,
  buildSongPlaces,
  genreVocabulary,
  plainStory,
  songKey,
  topGenres,
  verifiedIndex,
  verifiedVideoFor,
} from '../lib/cultures.mjs'

const id = (n) => `v${String(n).padStart(10, '0')}`

/** n verified releases from one place, one per year from `from`. */
function released(country, from, n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    c: country,
    y: from + (i % 10),
    n: `${country} Artist ${i}`,
    t: `Song ${i}`,
    v: id(from * 100 + i + country.charCodeAt(0) * 10000),
    g: ['rock'],
    ...extra,
  }))
}

const base = {
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
    { c: 'GB', y: 1970, n: 'George Harrison', t: 'My Sweet Lord', vs: 'My Sweet Lord', v: 'lttZj3oIht4' },
    { c: 'GB', y: 1970, n: 'No Video', t: 'Silent' },
  ],
}
const index = verifiedIndex(base)

test('a chart pick joins the hits sweep only under its own chart', () => {
  assert.equal(verifiedVideoFor(index, 'US', 'Aretha Franklin', 'Respect')?.videoId, '_zv_Zoa-j2Q')
  assert.equal(verifiedVideoFor(index, 'US', 'Aretha Franklin', 'Respect')?.source, 'chart')
  assert.equal(verifiedVideoFor(index, 'DE', 'Aretha Franklin', 'Respect'), null)
  assert.equal(verifiedVideoFor(index, 'GB', 'Blondie', 'Heart of Glass')?.live, true)
})

test('names compare case-, accent- and punctuation-insensitively', () => {
  assert.equal(verifiedVideoFor(index, 'NG', 'FELA KUTI', 'zombie')?.videoId, 'RUSg31Ignw4')
  assert.equal(verifiedVideoFor(index, 'DE', 'george harrison', 'My Sweet Lord!')?.source, 'on-this-day')
})

test('a different artist, a different song or a version never joins', () => {
  assert.equal(verifiedVideoFor(index, 'NG', 'Fela Kuti', 'Water No Get Enemy'), null)
  assert.equal(verifiedVideoFor(index, 'NG', 'Femi Kuti', 'Zombie'), null)
  assert.equal(verifiedVideoFor(index, 'NG', 'Someone', 'Lagos'), null)
})

test('missing is never a match (standing lesson 5)', () => {
  assert.equal(songKey('', 'Zombie'), null)
  assert.equal(songKey('★', '☆'), null)
  assert.equal(verifiedVideoFor(index, 'NG', '', ''), null)
})

const era = (country, from, to, items) => ({
  country,
  from,
  to,
  era: 'An era',
  kind: 'documented',
  basis: 'Documented scene history.',
  story: '[[Someone]] made the sound.',
  items,
  sources: [],
})

test('an era journey lists ONLY playable songs: picks first, then released songs', () => {
  const idx = verifiedIndex({ ...base, otdItems: [...base.otdItems, ...released('NG', 1970, 8)] })
  const [journey] = buildEraJourneys(
    [era('NG', 1970, 1979, [
      { artist: 'Fela Kuti', work: 'Zombie', note: '1976' },
      { artist: 'King Sunny Adé', work: 'Synchro System' },
    ])],
    idx,
    () => 'Nigeria',
  )
  assert.equal(journey.id, 'NG-1970-1979')
  assert.equal(journey.summary, 'Someone made the sound.')
  assert.equal(journey.picks, 1)
  assert.equal(journey.tracks[0].title, 'Zombie')
  assert.equal(journey.tracks[0].group, 'pick')
  assert.ok(journey.tracks.every((track) => /^[\w-]{11}$/.test(track.videoId)))
  assert.ok(!journey.tracks.some((track) => track.title === 'Synchro System'))
  assert.ok(journey.tracks.slice(1).every((track) => track.group === 'more' && track.year >= 1970 && track.year <= 1979))
})

test('an era without enough playable songs is left out entirely', () => {
  const journeys = buildEraJourneys(
    [era('NG', 1950, 1959, [{ artist: 'Fela Kuti', work: 'Zombie' }])],
    index,
    () => 'Nigeria',
  )
  assert.deepEqual(journeys, [])
})

test('released songs from another place or outside the span never join an era', () => {
  const idx = verifiedIndex({
    ...base,
    otdItems: [...released('GH', 1972, 9), ...released('NG', 1990, 9)],
  })
  assert.deepEqual(buildEraJourneys([era('NG', 1970, 1979, [])], idx, () => 'Nigeria'), [])
})

test('demoted families (children\'s, educational) never fill a journey', () => {
  const idx = verifiedIndex({ ...base, otdItems: released('NG', 1970, 9, { g: ['kids music'] }) })
  assert.deepEqual(buildEraJourneys([era('NG', 1970, 1979, [])], idx, () => 'Nigeria', new Set(['kids music'])), [])
})

test('decade journeys need enough artists, cap each artist, and skip covered decades', () => {
  const many = released('JP', 1980, 12)
  const sameArtist = released('KR', 1990, 12).map((item) => ({ ...item, n: 'One Artist' }))
  const idx = verifiedIndex({ ...base, otdItems: [...many, ...sameArtist, ...released('NG', 1970, 12)] })
  const eras = buildEraJourneys([era('NG', 1970, 1979, [])], idx, () => 'Nigeria')
  const decades = buildDecadeJourneys(idx, (code) => code, eras)
  const jp = decades.find((d) => d.id === 'JP-1980s')
  assert.ok(jp)
  assert.equal(jp.title, 'JP in the 1980s')
  assert.ok(jp.count >= MIN_JOURNEY_TRACKS && jp.count <= 15)
  // One artist with twelve songs is not a decade's worth of artists.
  assert.equal(decades.find((d) => d.code === 'KR'), undefined)
  // Nigeria's 1970s are the era journey's — never shown twice.
  assert.equal(decades.find((d) => d.code === 'NG'), undefined)
})

test('genre labels come only from the shared vocabulary', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => ({ n: `A${i}`, g: ['jazz', 'american'] })),
    { n: 'B', g: ['death by plane crash', 'jazz'] },
    { n: 'C', g: ['death by plane crash', 'jazz', '1960s'] },
  ]
  const vocabulary = genreVocabulary(items)
  assert.ok(vocabulary.has('jazz'))
  assert.ok(!vocabulary.has('american'))
  assert.deepEqual(topGenres(items.slice(30), vocabulary), ['jazz'])
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
})

test('plainStory strips listen-link markup only', () => {
  assert.equal(plainStory('When [[The Beatles]] hit [[US]] radio'), 'When The Beatles hit US radio')
})
