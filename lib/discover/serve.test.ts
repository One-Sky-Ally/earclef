/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/serve.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playablePicks, sanitizeStockPick } from './serve.ts'
import type { DiscoverPick } from './types.ts'

const MBID = '0f0d8d1a-5b52-4a0b-9d0f-3c3b1c5d2e7a'
const song = { videoId: 'abcdefghijk', title: 'Goodbye', uploadTitle: 'x', kind: 'official-video', source: 'discogs', uploader: 'toe official' }
const pick = (extra: Partial<DiscoverPick> = {}) =>
  ({
    name: 'toe',
    why: 'For fans of Mogwai',
    knownFor: 'Hear You',
    knownForVerified: true,
    mbid: MBID,
    play: null,
    read: { kind: 'musicbrainz', url: `https://musicbrainz.org/artist/${MBID}` },
    listenHref: '',
    song: null,
    bandcamp: null,
    ...extra,
  }) as DiscoverPick

test('a pick with no playable song is never shown (the Songs-about rule)', () => {
  const shown = playablePicks([pick(), pick({ song: song as DiscoverPick['song'] })])
  assert.equal(shown.length, 1)
  assert.equal(shown[0].song?.videoId, 'abcdefghijk')
})

test('a stocked pick without a verified song is refused at upload', () => {
  const slugs = new Set<string>()
  assert.equal(sanitizeStockPick(pick(), slugs), null)
  assert.equal(sanitizeStockPick({ ...pick(), song: { ...song, videoId: 'bad' } }, slugs), null)
  assert.equal(sanitizeStockPick({ ...pick(), song }, slugs)?.song?.videoId, 'abcdefghijk')
})
