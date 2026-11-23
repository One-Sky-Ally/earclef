/**
 * Release-level links: the release itself on a service, confirmed —
 * never a search (owner, Nov 23 2026: Björk's "The Björk Sides" opened an
 * Amazon search full of Moby and Michael Jackson).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/listen/releaseLinks.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appleCollectionUrl,
  checkFromReleases,
  linksFromUrls,
  matchByTitle,
  titleKey,
} from './releaseLinks.ts'

test('service album links MusicBrainz editors attached are read into one clean link each', () => {
  const links = linksFromUrls([
    'https://open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8',
    'https://music.apple.com/fr/album/6819802963',
    'https://tidal.com/album/569120137',
    'https://music.youtube.com/playlist?list=OLAK5uy_n3bpxgtQFZYqRZuK393wSRII3UB4D5_ck',
    'https://www.deezer.com/album/1134408361',
    'https://music.amazon.com/albums/B0GYQCQ4H6',
  ])
  assert.deepEqual(links, {
    spotify: 'https://open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8',
    appleMusic: 'https://music.apple.com/fr/album/6819802963',
    tidal: 'https://tidal.com/album/569120137',
    youtubeMusic: 'https://music.youtube.com/playlist?list=OLAK5uy_n3bpxgtQFZYqRZuK393wSRII3UB4D5_ck',
    deezer: 'https://www.deezer.com/album/1134408361',
    amazonMusic: 'https://music.amazon.com/albums/B0GYQCQ4H6',
  })
})

test('older link shapes are read too, and the first link per service wins', () => {
  assert.deepEqual(
    linksFromUrls([
      'https://itunes.apple.com/gb/album/some-title/id1445306981',
      'https://listen.tidal.com/album/496281239',
      'https://www.tidal.com/browse/album/1',
      'https://www.deezer.com/en/album/912670531',
      'https://open.spotify.com/intl-de/album/3XKBl8eJQzEddmR2tR1Ww0',
      'https://open.spotify.com/album/0000000000000000000000',
    ]),
    {
      appleMusic: 'https://music.apple.com/gb/album/1445306981',
      tidal: 'https://tidal.com/album/496281239',
      deezer: 'https://www.deezer.com/album/912670531',
      spotify: 'https://open.spotify.com/album/3XKBl8eJQzEddmR2tR1Ww0',
    },
  )
})

test('tracks, artists, videos, searches and lookalike hosts are never release links', () => {
  assert.deepEqual(
    linksFromUrls([
      'https://open.spotify.com/track/1V8Qu6CwkBfYucnCWxynq8',
      'https://open.spotify.com/artist/7w29UYBi0qsHi5RTcv3lmA',
      'https://www.youtube.com/watch?v=ZNC1vkap2xY',
      'https://music.youtube.com/watch?v=ZNC1vkap2xY',
      'https://music.youtube.com/playlist?list=PL1234567890',
      'https://music.apple.com/us/album/the-album/1500000000?i=1500000001',
      'https://music.amazon.com/albums/B0GYQCQ4H6?trackAsin=B0GYQCQ4H7',
      'https://music.apple.com/us/search?term=bjork',
      'https://music.amazon.com/search/bjork',
      'https://evil.example/open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8',
      'https://open.spotify.com.evil.example/album/1V8Qu6CwkBfYucnCWxynq8',
    ]),
    {},
  )
})

test('an Apple collection link loses its tracking query', () => {
  assert.equal(
    appleCollectionUrl('https://music.apple.com/us/album/where-is-the-line-single/6826427115?uo=4'),
    'https://music.apple.com/us/album/where-is-the-line-single/6826427115',
  )
  assert.equal(appleCollectionUrl('https://evil.example/album/1?uo=4'), undefined)
  assert.equal(appleCollectionUrl(undefined), undefined)
})

test('title keys drop the " - Single" / " - EP" suffix and accents, nothing else', () => {
  assert.equal(titleKey('Where Is the Line (Live at Harpa Hall, Reykjavík) - Single'), titleKey('Where Is the Line (Live at Harpa Hall, Reykjavik)'))
  assert.equal(titleKey('London—Hackney'), titleKey('London-Hackney'))
  assert.notEqual(titleKey('Homogenic'), titleKey('Homogenic Live'))
  assert.equal(titleKey('!!!'), '')
})

test('matching by title: exact first, then the edition-blind key, never a partial title', () => {
  const albums = [
    { title: 'In The Pines (feat. Dolly Parton)', id: 'feat' },
    { title: 'Sing', id: 'sing' },
    { title: 'Sing (Deluxe Edition)', id: 'sing-deluxe' },
  ]
  assert.equal(matchByTitle('Sing', albums, (album) => album.title)?.id, 'sing')
  assert.equal(matchByTitle('In the Pines', albums, (album) => album.title)?.id, 'feat')
  assert.equal(matchByTitle('Sin', albums, (album) => album.title), undefined)
  assert.equal(matchByTitle('Singing', albums, (album) => album.title), undefined)
  assert.equal(matchByTitle('', [{ title: '' }], (album) => album.title), undefined)
})

const release = (status: string | null, date: string | undefined, urls: [string, string][]) => ({
  status,
  date,
  relations: urls.map(([type, resource]) => ({ type, url: { resource } })),
})

test('a release group is real when an OFFICIAL release has a service link, a store page or a Discogs entry', () => {
  const check = checkFromReleases([
    release('Bootleg', '2026', [['free streaming', 'https://open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8']]),
    release('Official', '2026-07-15', [['purchase for download', 'https://deadcandance.bandcamp.com/album/the-cicadas']]),
  ])
  assert.deepEqual(check, { official: true, links: {}, documented: true, date: '2026-07-15' })
})

test('bootleg, promotion and withdrawn releases never confirm anything, links or not', () => {
  const check = checkFromReleases([
    release('Bootleg', '2026', [['free streaming', 'https://open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8']]),
    release('Promotion', '2026-07', [['discogs', 'https://www.discogs.com/release/1']]),
    release('Withdrawn', '2026-03-12', [['streaming', 'https://tidal.com/album/1']]),
  ])
  assert.deepEqual(check, { official: false, links: {}, documented: false })
})

test('a video or a show-notes page is not where a release lives', () => {
  const check = checkFromReleases([
    release('Official', '2026-07-18', [
      ['free streaming', 'https://www.youtube.com/watch?v=ZNC1vkap2xY'],
      ['show notes', 'https://www.abc.net.au/triplej/like-a-version/x'],
      ['other databases', 'https://rateyourmusic.com/release/single/x/'],
    ]),
  ])
  assert.deepEqual(check, { official: true, links: {}, documented: false, date: '2026-07-18' })
})

test('service links from every official release are gathered, earliest full date kept', () => {
  const check = checkFromReleases([
    release('Official', '2026-11-27', [['streaming', 'https://music.apple.com/us/album/6819756090']]),
    release('Official', '2026-05-26', [
      ['purchase for download', 'https://bjork.bandcamp.com/album/x'],
      ['free streaming', 'https://open.spotify.com/album/0Ad99OHFX3OjhZ410joegz'],
    ]),
  ])
  assert.deepEqual(check, {
    official: true,
    links: {
      appleMusic: 'https://music.apple.com/us/album/6819756090',
      spotify: 'https://open.spotify.com/album/0Ad99OHFX3OjhZ410joegz',
    },
    documented: true,
    date: '2026-05-26',
  })
})

test('each service’s link comes from the worldwide release first, then the US one', () => {
  const check = checkFromReleases([
    { ...release('Official', '2022-09-30', [['streaming', 'https://music.apple.com/de/album/1']]), country: 'DE' },
    { ...release('Official', '2022-09-30', [['streaming', 'https://music.apple.com/us/album/2']]), country: 'US' },
    { ...release('Official', '2022-10-01', [['free streaming', 'https://open.spotify.com/album/0Ad99OHFX3OjhZ410joegz']]), country: 'XW' },
  ])
  assert.deepEqual(check.links, {
    spotify: 'https://open.spotify.com/album/0Ad99OHFX3OjhZ410joegz',
    appleMusic: 'https://music.apple.com/us/album/2',
  })
})

test('a barcode or a discography page documents an official release; a bootleg’s barcode does not', () => {
  assert.equal(checkFromReleases([{ ...release('Official', '2026-11-06', []), barcode: '199584518527' }]).documented, true)
  assert.equal(checkFromReleases([release('Official', '2026-04-18', [['discography entry', 'https://recordstoreday.com/SpecialRelease/19796']])]).documented, true)
  assert.equal(checkFromReleases([{ ...release('Bootleg', '2026', []), barcode: '199584518527' }]).documented, false)
  assert.equal(checkFromReleases([{ ...release('Official', '2026-03-27', []), barcode: '' }]).documented, false)
  assert.equal(checkFromReleases([{ ...release('Official', '2026-03-27', []), barcode: 'none' }]).documented, false)
})
