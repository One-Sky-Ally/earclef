/**
 * "Not on X" is a claim with a bar: present on any evidence, absent
 * only when every leg that could run agreed, unknown otherwise.
 *   node --test scripts/test/service-absence-verdict.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideVerdict,
  hostMatchesService,
  searchNamesArtist,
} from '../lib/serviceAbsenceVerdict.mjs'

test('any presence leg wins', () => {
  assert.equal(decideVerdict({ content: 'present', musicbrainz: 'absent', search: 'absent' }), 'present')
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'present', search: 'absent' }), 'present')
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'failed', search: 'present' }), 'present')
})

test('absent needs the search to have run empty and MusicBrainz to be clear', () => {
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'absent', search: 'absent' }), 'absent')
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'no-record', search: 'absent' }), 'absent')
  // A missing link in our data is not proof.
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'absent', search: 'unavailable' }), 'unknown')
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'failed', search: 'absent' }), 'unknown')
  assert.equal(decideVerdict({ content: 'absent', musicbrainz: 'absent', search: 'failed' }), 'unknown')
})

test('URL relations prove presence only on the service\'s own host', () => {
  assert.equal(hostMatchesService('https://open.spotify.com/artist/abc', 'spotify'), true)
  assert.equal(hostMatchesService('https://music.apple.com/us/artist/x/1', 'appleMusic'), true)
  assert.equal(hostMatchesService('https://www.deezer.com/artist/1', 'deezer'), true)
  assert.equal(hostMatchesService('https://tidal.com/browse/artist/1', 'tidal'), true)
  assert.equal(hostMatchesService('https://music.amazon.com/artists/B09', 'amazonMusic'), true)
  assert.equal(hostMatchesService('https://www.amazon.com/dp/B000', 'amazonMusic'), false)
  assert.equal(hostMatchesService('https://www.amazon.com/music/player/artists/B09', 'amazonMusic'), true)
  assert.equal(hostMatchesService('https://open.spotify.com/artist/abc', 'deezer'), false)
  assert.equal(hostMatchesService('not a url', 'spotify'), false)
})

test('a search hit counts only on the exact normalized name', () => {
  assert.equal(searchNamesArtist(['Joanna Newsom Tribute', 'Newsom'], 'Joanna Newsom'), false)
  assert.equal(searchNamesArtist(['joanna newsom'], 'Joanna Newsom'), true)
  assert.equal(searchNamesArtist(['Björk'], 'Bjork'), true)
  assert.equal(searchNamesArtist([], 'Joanna Newsom'), false)
})

test('a YouTube channel or YouTube Music page proves presence on YouTube Music', () => {
  assert.equal(hostMatchesService('https://www.youtube.com/channel/UCabc', 'youtubeMusic'), true)
  assert.equal(hostMatchesService('https://music.youtube.com/channel/UCabc', 'youtubeMusic'), true)
  assert.equal(hostMatchesService('https://open.spotify.com/artist/abc', 'youtubeMusic'), false)
})
