/**
 * "On this day" play links (owner, Oct 10 2026): "only verified videos
 * get a play button, and only playable songs go in the playlist."
 * The identity bar is the gap-fill play repair's: an ID-level anchor (the
 * artist's own Discogs id, from MusicBrainz's url relation, credited on
 * the record) plus a corroboration (an exact title, or a unique ±3 s
 * length) — and the Discogs record must BE the release on the page:
 * same title, same year.
 *   node --test scripts/test/on-this-day-play.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasKeys } from '../lib/extraPlayIdentity.mjs'
import { candidateVideos } from '../lib/onThisDayPlay.mjs'

const ME = 100
const OTHER = 200
const video = (videoId, title, duration = null) => ({ videoId, title, duration })
const track = (position, title, duration = '', artists = []) => ({ position, title, duration, artists })
const record = (extra = {}) => ({
  id: 1,
  title: 'Good Vibrations',
  year: 1966,
  artists: [{ id: ME, name: 'The Beach Boys' }],
  tracklist: [track('A', 'Good Vibrations', '3:35'), track('B', "Let's Go Away For Awhile", '2:18')],
  videos: [],
  ...extra,
})
const item = { y: 1966, t: 'Good Vibrations', n: 'The Beach Boys' }
const pick = (records, overrides = {}) =>
  candidateVideos({ item: { ...item, ...overrides }, artistIds: new Set([ME]), records, aliases: aliasKeys({ name: 'The Beach Boys' }) })

test('the artist\'s own record, same title and year, and a video titled as its track: verified', () => {
  const found = pick([record({ videos: [video('aaaaaaaaaaa', 'The Beach Boys - Good Vibrations')] })])
  assert.deepEqual(found.map((candidate) => candidate.videoId), ['aaaaaaaaaaa'])
  assert.equal(found[0].matchedTitle, 'Good Vibrations')
  assert.equal(found[0].anchor, 'whole')
})

test('a record with another title or another year is not this release (a reissue, a compilation)', () => {
  const videos = [video('aaaaaaaaaaa', 'Good Vibrations')]
  assert.deepEqual(pick([record({ year: 1976, videos })]), [])
  assert.deepEqual(pick([record({ title: 'Endless Summer', videos })]), [])
  assert.deepEqual(pick([record({ year: null, videos })]), [])
})

test('a shared record is only good for a track this artist is credited on', () => {
  const shared = record({
    artists: [{ id: OTHER, name: 'Someone' }, { id: ME, name: 'The Beach Boys' }],
    tracklist: [track('A', 'Good Vibrations', '3:35', [ME]), track('B', 'Other Song', '2:00', [OTHER])],
    videos: [video('aaaaaaaaaaa', 'Good Vibrations'), video('bbbbbbbbbbb', 'Other Song')],
  })
  const found = pick([shared])
  assert.deepEqual(found.map((candidate) => candidate.videoId), ['aaaaaaaaaaa'])
  assert.equal(found[0].anchor, 'track')
})

test('a video that matches nothing on the record is not corroborated; a unique length is', () => {
  const vague = record({ videos: [video('ccccccccccc', 'Beach Boys live 1967')] })
  assert.deepEqual(pick([vague]), [])
  const timed = record({ videos: [video('ddddddddddd', 'untitled upload', 216)] })
  const found = pick([timed])
  assert.equal(found[0].videoId, 'ddddddddddd')
  assert.equal(found[0].leg, 'duration')
})

test('the release\'s own title track comes first, then the record\'s other tracks in order', () => {
  const album = record({
    title: 'Pet Sounds',
    tracklist: [track('A1', "Wouldn't It Be Nice"), track('A2', 'You Still Believe In Me'), track('B6', 'Pet Sounds')],
    videos: [video('eeeeeeeeeee', 'You Still Believe In Me'), video('fffffffffff', 'Pet Sounds (Stereo)'), video('ggggggggggg', "Wouldn't It Be Nice")],
  })
  const found = pick([album], { t: 'Pet Sounds' })
  assert.deepEqual(found.map((candidate) => candidate.videoId), ['fffffffffff', 'ggggggggggg', 'eeeeeeeeeee'])
})

test('a Various record is never this artist\'s release', () => {
  const various = record({ artists: [{ id: 194, name: 'Various' }], videos: [video('aaaaaaaaaaa', 'Good Vibrations')] })
  assert.deepEqual(pick([various]), [])
})

test('the same video on two pressings is offered once', () => {
  const videos = [video('aaaaaaaaaaa', 'Good Vibrations')]
  assert.equal(pick([record({ id: 1, videos }), record({ id: 2, videos })]).length, 1)
})
