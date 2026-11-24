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

test('Discover names a video by its title only: a matching length never names the song (Nov 24, 2026)', () => {
  // The Mike Flowers Pops: the official "Don't Cry For My Argentina" video
  // ran the length of the B-side, "I Dreamt I Was Dreaming".
  const single = record({
    title: 'Light My Fire',
    tracklist: [track('Light My Fire', '3:59'), track('I Dreamt I Was Dreaming', '4:12')],
    videos: [video('eeeeeeeeeee', "The Mike Flowers Pops - Don't Cry For My Argentina (Official Video)", 251)],
  })
  const aliases = aliasKeysOf(['The Mike Flowers Pops'])
  assert.deepEqual(recordSongCandidates([single], new Set([ME]), aliases, { byLength: false }), [])
  // Callers that still allow the length leg (Songs about this place) are unchanged.
  assert.equal(recordSongCandidates([single], new Set([ME]), aliases)[0]?.leg, 'duration')
  // A video that names its track still passes with the length leg off.
  const named = record({ videos: [video('fffffffffff', 'The Beach Boys - Good Vibrations', 215)] })
  assert.equal(
    recordSongCandidates([named], new Set([ME]), aliasKeysOf(['The Beach Boys']), { byLength: false })[0]?.songTitle,
    'Good Vibrations',
  )
})

test("a track credited to someone else is theirs, even on this artist's DJ mix (Nov 24, 2026: Cheb i Sabbah)", () => {
  const mix = record({
    title: 'As Far As - A DJ Mix',
    tracklist: [track('Sinikan', '5:10', [OTHER]), track('Kese Kese', '6:00', [ME])],
    videos: [video('sssssssssss', 'Sekouba Bambino - Sinikan (Clip Officiel)'), video('kkkkkkkkkkk', 'Kese Kese')],
  })
  assert.deepEqual(pick([mix]).map((c) => c.songTitle), ['Kese Kese'])
  // A whole-credit record whose tracks carry no credit of their own is still the artist's.
  assert.deepEqual(pick([record({ videos: [video('aaaaaaaaaaa', 'Good Vibrations')] })]).map((c) => c.songTitle), ['Good Vibrations'])
})
