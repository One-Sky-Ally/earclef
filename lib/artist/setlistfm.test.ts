/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/artist/setlistfm.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setlistFmArtistUrl, setlistFmSearchUrl } from './setlistfm.ts'

const rel = (resource: string, type = 'setlistfm') => ({ type, url: { resource } })

test("MusicBrainz's setlist.fm page is the exact link, normalised", () => {
  assert.equal(
    setlistFmArtistUrl([
      rel('https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb', 'free streaming'),
      rel('http://setlist.fm/setlists/radiohead-bd6bd12.html'),
    ]),
    'https://www.setlist.fm/setlists/radiohead-bd6bd12.html',
  )
})

test('a single setlist (not the artist page) or another host is no match', () => {
  assert.equal(
    setlistFmArtistUrl([
      rel('https://www.setlist.fm/setlist/radiohead/2025/uber-arena-berlin-germany-1340c9c5.html'),
      rel('https://www.setlist.fm.example.com/setlists/radiohead-bd6bd12.html'),
      rel('not a url'),
    ]),
    null,
  )
  assert.equal(setlistFmArtistUrl([]), null)
})

test('two different pages are ambiguous — missing is never a match', () => {
  assert.equal(
    setlistFmArtistUrl([
      rel('https://www.setlist.fm/setlists/radiohead-bd6bd12.html'),
      rel('https://www.setlist.fm/setlists/radiohead-7bd6aa34.html'),
    ]),
    null,
  )
  assert.equal(
    setlistFmArtistUrl([
      rel('https://www.setlist.fm/setlists/radiohead-bd6bd12.html'),
      rel('https://setlist.fm/setlists/radiohead-bd6bd12.html'),
    ]),
    'https://www.setlist.fm/setlists/radiohead-bd6bd12.html',
  )
})

test('the search link carries the name safely', () => {
  assert.equal(
    setlistFmSearchUrl('Amadou & Mariam'),
    'https://www.setlist.fm/search?query=Amadou%20%26%20Mariam',
  )
})
