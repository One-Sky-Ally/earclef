/**
 * The On-this-day identity bar, record-agnostic: a Discover pick has no
 * single release on the page, so every record the artist's own Discogs
 * id is credited on is a source — the bar itself is unchanged.
 *   node --test lib/play/songIdentity.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordSongCandidates, type DiscogsRecord } from './songIdentity.ts'
import { aliasKeysOf } from './titleVariants.ts'

const ME = 100
const OTHER = 200
const video = (videoId: string, title: string, duration: number | null = null) => ({ videoId, title, duration })
const track = (title: string, duration = '', artists: number[] = []) => ({ title, duration, artists })
const record = (extra: Partial<DiscogsRecord> = {}): DiscogsRecord => ({
  id: 1,
  title: 'Good Vibrations',
  year: 1966,
  artists: [ME],
  tracklist: [track('Good Vibrations', '3:35'), track("Let's Go Away For Awhile", '2:18')],
  videos: [],
  labels: [],
  ...extra,
})
const pick = (records: DiscogsRecord[]) =>
  recordSongCandidates(records, new Set([ME]), aliasKeysOf(['The Beach Boys']))

test("the artist's own record and a video titled as its track: verified, with the song's catalog title", () => {
  const found = pick([record({ videos: [video('aaaaaaaaaaa', 'The Beach Boys - Good Vibrations (Official Video)')] })])
  assert.deepEqual(found.map((c) => c.videoId), ['aaaaaaaaaaa'])
  assert.equal(found[0].songTitle, 'Good Vibrations')
  assert.equal(found[0].release, 'Good Vibrations')
  assert.equal(found[0].anchor, 'whole')
})

test('a shared record is only good for a track this artist is credited on', () => {
  const shared = record({
    artists: [OTHER, ME],
    tracklist: [track('Good Vibrations', '3:35', [ME]), track('Other Song', '2:00', [OTHER])],
    videos: [video('aaaaaaaaaaa', 'Good Vibrations'), video('bbbbbbbbbbb', 'Other Song')],
  })
  const found = pick([shared])
  assert.deepEqual(found.map((c) => c.videoId), ['aaaaaaaaaaa'])
  assert.equal(found[0].anchor, 'track')
})

test('a video matching nothing on the record is not corroborated; a unique length is', () => {
  assert.deepEqual(pick([record({ videos: [video('ccccccccccc', 'Beach Boys live 1967')] })]), [])
  const found = pick([record({ videos: [video('ddddddddddd', 'untitled upload', 216)] })])
  assert.equal(found[0]?.videoId, 'ddddddddddd')
  assert.equal(found[0]?.leg, 'duration')
})

test('a Various record or an uncredited record is never this artist\'s', () => {
  const videos = [video('aaaaaaaaaaa', 'Good Vibrations')]
  assert.deepEqual(pick([record({ artists: [194], videos })]), [])
  assert.deepEqual(pick([record({ artists: [], videos })]), [])
})

test('the same video on two records is offered once; records keep their order', () => {
  const videos = [video('aaaaaaaaaaa', 'Good Vibrations')]
  const later = record({ id: 2, title: 'Pet Sounds', tracklist: [track('Pet Sounds')], videos: [video('eeeeeeeeeee', 'Pet Sounds')] })
  const found = pick([record({ id: 1, videos }), record({ id: 3, videos }), later])
  assert.deepEqual(found.map((c) => c.videoId), ['aaaaaaaaaaa', 'eeeeeeeeeee'])
})
