/**
 * Artist "Start here" join (scripts/lib/startHere.mjs): verified songs
 * join a roster artist by MusicBrainz id only, never by name.
 *   node --test scripts/test/start-here.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStartHere } from '../lib/startHere.mjs'

const MBID = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3'
const roster = [{ slug: 'queen', mbid: MBID, curated: ['fJ9rUzIMcZQ'] }]

test('songs join by MusicBrainz id, skip hand-picked videos, sort by year', () => {
  const result = buildStartHere(
    roster,
    [
      { a: MBID, n: 'Queen', t: 'Jazz', vs: 'Bicycle Race', v: 'GugsCdLHm-Q', y: 1978 },
      { a: MBID, n: 'Queen', t: 'A Night at the Opera', vs: 'Bohemian Rhapsody', v: 'fJ9rUzIMcZQ', y: 1975 },
      { a: MBID, n: 'Queen', t: 'Queen II', v: 'aaaaaaaaaaa', y: 1974 },
      // Same name, no id: never joins.
      { n: 'Queen', t: 'Impostor', v: 'bbbbbbbbbbb', y: 1980 },
    ],
    {},
  )
  assert.deepEqual(result.queen.map((song) => song.t), ['Queen II', 'Bicycle Race'])
  assert.equal(result.queen[1].r, 'Jazz')
})

test('songs about a place join only as plain records', () => {
  const result = buildStartHere(roster, [], {
    GB: {
      songs: [
        { t: '"London Song"', a: 'Queen', mbid: MBID, v: 'ccccccccccc', y: 1979 },
        { t: 'Live Song', a: 'Queen', mbid: MBID, v: 'ddddddddddd', ver: 'live' },
      ],
    },
  })
  assert.deepEqual(result.queen.map((song) => song.t), ['London Song'])
})

test('the same song never appears twice, hand-picked titles included', () => {
  const result = buildStartHere(
    [{ slug: 'radiohead', mbid: MBID, curated: [], curatedTitles: ['No Surprises (Official Video)'] }],
    [
      { a: MBID, t: '2 + 2 = 5', vs: '2 + 2 = 5 (The Lukewarm.)', v: 'fffffffffff', y: 2003 },
      { a: MBID, t: 'Hail to the Thief', vs: '2+2=5', v: 'ggggggggggg', y: 2003 },
      { a: MBID, t: 'OK Computer', vs: 'No Surprises', v: 'hhhhhhhhhhh', y: 1997 },
    ],
    {},
  )
  assert.deepEqual(result.radiohead.map((song) => song.v), ['fffffffffff'])
})

test('a malformed video id or a missing artist id never joins', () => {
  const result = buildStartHere(
    [...roster, { slug: 'nobody', mbid: null, curated: [] }],
    [
      { a: MBID, t: 'Broken', v: 'short', y: 1990 },
      { a: '', t: 'No id', v: 'eeeeeeeeeee', y: 1990 },
    ],
    {},
  )
  assert.equal(result.queen, undefined)
  assert.equal(result.nobody, undefined)
})
