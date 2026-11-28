/**
 * The radar from saved songs never shadows an artist already followed —
 * by their page, or by their MusicBrainz id when they have no page.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/fans/radar.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRadar } from './radar.ts'

const RHYE = 'aa914efa-d6cb-4816-906f-8edafb08418e'
const BOOGARINS = '46713d05-4143-4704-a9c3-71b482a13944'
const like = (mbid: string, artistName: string, videoId: string) => ({
  videoId,
  title: 'Song',
  artistName,
  mbid,
  likedAt: '2026-11-28T00:00:00.000Z',
})

test('a page-less artist followed by id leaves the radar; one not followed stays, followable', () => {
  const radar = deriveRadar({
    likes: [like(RHYE, 'Rhye', 'aaaaaaaaaaa'), like(BOOGARINS, 'Boogarins', 'bbbbbbbbbbb')],
    dismissed: [],
    rosterByMbid: {},
    followedSlugs: [`mb:${RHYE}`],
  })
  assert.deepEqual(
    radar.artists.map((artist) => artist.name),
    ['Boogarins'],
  )
})
