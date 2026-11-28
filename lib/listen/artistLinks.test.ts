/**
 * The artist's own page on each service, read from MusicBrainz's url
 * relations — the "Listen on" picker on Discover picks (Nov 28 2026).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/listen/artistLinks.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artistLinksFromUrls } from './artistLinks.ts'

test('each service reads only its artist pages, in a clean form', () => {
  assert.deepEqual(
    artistLinksFromUrls([
      'https://open.spotify.com/artist/55IyYO6fmYpYw6Nd4YF7bw?si=abc',
      'https://music.apple.com/us/artist/zager-evans/1443800?uo=4',
      'https://music.amazon.com/artists/B000QJPJ5Q/zager-and-evans',
      'https://www.deezer.com/fr/artist/12345',
      'https://listen.tidal.com/artist/4049',
      'https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    ]),
    {
      spotify: 'https://open.spotify.com/artist/55IyYO6fmYpYw6Nd4YF7bw',
      appleMusic: 'https://music.apple.com/us/artist/zager-evans/1443800',
      amazonMusic: 'https://music.amazon.com/artists/B000QJPJ5Q',
      deezer: 'https://www.deezer.com/artist/12345',
      tidal: 'https://tidal.com/browse/artist/4049',
      youtubeMusic: 'https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    },
  )
})

test('albums, tracks, playlists and other sites are not artist pages', () => {
  assert.deepEqual(
    artistLinksFromUrls([
      'https://open.spotify.com/album/1A2B3C',
      'https://music.apple.com/us/album/x/123',
      'https://www.deezer.com/album/99',
      'https://tidal.com/browse/album/1',
      'https://music.youtube.com/playlist?list=OLAK5uy_abc',
      'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
      'https://music.amazon.evil.example/artists/B000QJPJ5Q',
      'https://music.amazon.co.uk.phish.net/artists/B000QJPJ5Q',
      'javascript:alert(1)',
      'not a url',
    ]),
    {},
  )
})

test('the first page found for a service is kept', () => {
  assert.deepEqual(
    artistLinksFromUrls(['https://open.spotify.com/artist/AAA', 'https://open.spotify.com/artist/BBB']),
    { spotify: 'https://open.spotify.com/artist/AAA' },
  )
})
