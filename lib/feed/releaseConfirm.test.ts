/**
 * Recent releases are real or they are out (owner, Nov 23 2026) — and a
 * source that did not answer is never the reason one is out.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/releaseConfirm.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECK_TTL_MS,
  closestGroup,
  confirmRelease,
  deezerAlbums,
  deezerMatch,
  inReleaseWindow,
  refreshChecks,
  sameTime,
  type CheckCache,
  type DeezerAlbum,
  type Sources,
} from './releaseConfirm.ts'

const SEARCH = 'https://music.apple.com/us/search?term=x'
const mbItem = (title: string, date: string) => ({ type: 'release' as const, title, date, href: SEARCH })
const official = (extra: object = {}) => ({ official: true, links: {}, documented: true, ...extra })
const answered = (albums: DeezerAlbum[] = [], appleIds: string[] = ['6812476953']): Sources => ({
  deezer: { albums, answered: true },
  appleAnswered: true,
  appleIds: new Set(appleIds),
})

test('a release from the artist’s Apple Music catalogue stays, opening the album itself', () => {
  const apple = 'https://music.apple.com/us/album/where-is-the-line-single/6826427115'
  const out = confirmRelease(
    { ...mbItem('Where Is the Line (Live at Harpa Hall, Reykjavík)', '2026-10-28'), links: { appleMusic: apple } },
    undefined,
    answered(),
  )
  assert.equal(out?.href, apple)
  assert.deepEqual(out?.links, { appleMusic: apple })
  assert.equal(out?.date, '2026-10-28')
})

test('MusicBrainz answering "no official release" leaves it out', () => {
  const sources = { deezer: { albums: [], answered: false }, appleAnswered: false }
  assert.equal(confirmRelease(mbItem('The Björk Sides: The B-Sides', '2026-03-01'), { official: false, links: {}, documented: false }, sources), null)
})

test('official with nowhere real to be found: out only once every source answered', () => {
  const nowhere = official({ documented: false })
  assert.equal(confirmRelease(mbItem('Warehouse 10 Volume 15', '2026-03-01'), nowhere, answered()), null)
  // Apple, Deezer or MusicBrainz did not answer: it stays, a labelled search.
  const appleDown = { deezer: { albums: [], answered: true }, appleAnswered: false }
  const deezerDown = { deezer: { albums: [], answered: false }, appleAnswered: true }
  assert.deepEqual(confirmRelease(mbItem('Warehouse 10 Volume 15', '2026-03-01'), nowhere, appleDown)?.links, {})
  assert.deepEqual(confirmRelease(mbItem('Warehouse 10 Volume 15', '2026-03-01'), nowhere, deezerDown)?.links, {})
  assert.deepEqual(confirmRelease(mbItem('New Single', '2026-11-20'), undefined, answered())?.links, {})
})

test('official and on Bandcamp: it stays, and a year-only date takes the release’s full date', () => {
  assert.equal(confirmRelease(mbItem('Orkestral Live', '2026'), official(), answered()), null)
  // MusicBrainz never answered: the year-only row stays as it was, not dropped.
  const unread = mbItem('Warehouse 10 Volume 15', '2026')
  assert.equal(confirmRelease(unread, undefined, answered()), unread)
  const out = confirmRelease(mbItem('The Cicadas', '2026'), official({ date: '2026-07-15' }), answered())
  assert.equal(out?.date, '2026-07-15')
  assert.deepEqual(out?.links, {})
})

test('MusicBrainz service links on an official release become the release’s links', () => {
  const out = confirmRelease(
    mbItem('Flower in a Hurricane', '2026-10-15'),
    official({ links: { spotify: 'https://open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8', tidal: 'https://tidal.com/album/569120137' } }),
    answered(),
  )
  assert.deepEqual(out?.links, {
    spotify: 'https://open.spotify.com/album/1V8Qu6CwkBfYucnCWxynq8',
    tidal: 'https://tidal.com/album/569120137',
  })
  assert.equal(out?.href, SEARCH)
})

test('found in the artist’s Deezer catalogue: it stays with Deezer’s link; Deezer dates only a partial date', () => {
  const albums = [{ title: 'Smoke Gets In Your Eyes', date: '2026-06-16', link: 'https://www.deezer.com/album/1', type: 'single' }]
  assert.equal(confirmRelease(mbItem('Smoke Gets in Your Eyes (Live)', '2026-06'), undefined, answered(albums), 'Single')?.links?.deezer, undefined)
  // A credit Deezer leaves out is still the same release.
  const same = confirmRelease(mbItem('Smoke Gets in Your Eyes (with 13-Year-Old Jacob)', '2026-06'), undefined, answered(albums), 'Single')
  assert.equal(same?.date, '2026-06-16')
  assert.deepEqual(same?.links, { deezer: 'https://www.deezer.com/album/1' })
  const full = confirmRelease(mbItem('Smoke Gets In Your Eyes', '2026-06-12'), undefined, answered(albums), 'Single')
  assert.equal(full?.date, '2026-06-12')
})

test('Deezer: the same title from the same time, the closest date when several share it', () => {
  const albums = [
    { title: 'Fossora', date: '2022-09-30', link: 'https://www.deezer.com/album/album', type: 'album' },
    { title: 'Sing', date: '2012-03-05', link: 'https://www.deezer.com/album/old' },
    { title: 'Fossora', date: '2022-09-27', link: 'https://www.deezer.com/album/single', type: 'single' },
    { title: 'Y', date: '2026-09-20', link: 'https://www.deezer.com/album/y-single', type: 'single' },
    { title: 'X', date: '2027-01-15', link: 'https://www.deezer.com/album/next-year' },
    { title: 'In The Pines (feat. Dolly Parton)', date: '2026-03-20', link: 'https://www.deezer.com/album/pines', type: 'single' },
  ]
  // Kind unknown: the closest full date within a week.
  assert.equal(deezerMatch('Fossora', '2022-09-27', albums)?.link, 'https://www.deezer.com/album/single')
  assert.equal(deezerMatch('Fossora', '2022-09-30', albums)?.link, 'https://www.deezer.com/album/album')
  assert.equal(deezerMatch('Sing', '2026-10-16', albums), undefined)
  assert.equal(deezerMatch('X', '2026-10-01', albums), undefined)
  assert.equal(deezerMatch('In the Pines', '2026-03-20', albums, 'Single')?.link, 'https://www.deezer.com/album/pines')
  assert.equal(deezerMatch('In the Pines', '2026', albums, 'Single')?.link, 'https://www.deezer.com/album/pines')
  assert.equal(deezerMatch('Sing', '', albums), undefined)
  // Kind is required: an album is never its title-track single.
  assert.equal(deezerMatch('Fossora', '2022-09-27', albums, 'Album')?.link, 'https://www.deezer.com/album/album')
  assert.equal(deezerMatch('Fossora', '2022-09-30', albums, 'Single')?.link, 'https://www.deezer.com/album/single')
  assert.equal(deezerMatch('Y', '2026-10-31', albums, 'Album'), undefined)
  assert.equal(deezerMatch('Y', '2026-10-31', albums, 'EP')?.link, 'https://www.deezer.com/album/y-single')
  // Kind unknown on one side: only a full date within a week.
  assert.equal(deezerMatch('Y', '2026-09-25', albums)?.link, 'https://www.deezer.com/album/y-single')
  assert.equal(deezerMatch('Y', '2026-10-05', albums), undefined)
})

test('same time: 45 days for full dates, the next month for a month, the next year for a year', () => {
  assert.equal(sameTime('2026-10-01', '2026-11-14'), true)
  assert.equal(sameTime('2026-10-01', '2026-11-16'), false)
  assert.equal(sameTime('2026-10', '2026-11-30'), true)
  assert.equal(sameTime('2026-10', '2026-12-01'), false)
  assert.equal(sameTime('2026', '2025-02-01'), true)
  assert.equal(sameTime('2026', '2028-01-01'), false)
  assert.equal(sameTime('', '2026-01-01'), false)
})

test('an Apple release borrows the MusicBrainz group of the same kind and time, never a namesake', () => {
  const groups = [
    { id: 'album', date: '2022-09-30', type: 'Album' },
    { id: 'single', date: '2022-09-27', type: 'Single' },
    { id: 'nineties', date: '1997-09-22', type: 'Album' },
  ]
  assert.equal(closestGroup('2022-09-30', 'Album', groups), 'album')
  assert.equal(closestGroup('2022-09-27', 'Single', groups), 'single')
  assert.equal(closestGroup('2022-09-29', 'Single', groups), 'single')
  assert.equal(closestGroup('2026-05-01', 'Album', groups), undefined)
  // Only the other kind in range: no group at all.
  assert.equal(closestGroup('2026-10-31', 'Album', [{ id: 's', date: '2026-09-20', type: 'Single' }]), undefined)
  assert.equal(closestGroup('2026-10-31', 'Single', [{ id: 'a', date: '2026-10-31', type: 'Album' }]), undefined)
  assert.equal(closestGroup('2026-10-31', 'EP', [{ id: 's', date: '2026-10-25', type: 'Single' }]), 's')
  // A year-only group is too loose; an untyped one needs a date within a week.
  assert.equal(closestGroup('2026-03-10', 'Album', [{ id: 'y', date: '2025', type: 'Album' }]), undefined)
  assert.equal(closestGroup('2026-03-10', 'Album', [{ id: 'o', date: '2026-03-08', type: 'Other' }]), 'o')
  assert.equal(closestGroup('2026-03-10', 'Album', [{ id: 'o', date: '2026-02-20', type: 'Other' }]), undefined)
})

test('the Apple Music link wins the href, and catalogue links win over MusicBrainz ones', () => {
  const out = confirmRelease(
    { ...mbItem('Sexy Magic', '2026-09-17'), links: { appleMusic: 'https://music.apple.com/us/album/sexy-magic/1' } },
    official({ links: { appleMusic: 'https://music.apple.com/gb/album/6812476953', deezer: 'https://www.deezer.com/album/9', spotify: 'https://open.spotify.com/album/0CkBYPmr1j7EEWSQMHDBLg' } }),
    answered([{ title: 'Sexy Magic', date: '2026-09-17', link: 'https://www.deezer.com/album/2' }]),
  )
  assert.deepEqual(out?.links, {
    appleMusic: 'https://music.apple.com/us/album/sexy-magic/1',
    deezer: 'https://www.deezer.com/album/2',
    spotify: 'https://open.spotify.com/album/0CkBYPmr1j7EEWSQMHDBLg',
  })
  assert.equal(out?.href, 'https://music.apple.com/us/album/sexy-magic/1')
})

test('the window: the past year and everything announced', () => {
  assert.equal(inReleaseWindow('2026-11-23', '2026-11-23'), true)
  assert.equal(inReleaseWindow('2025-11-24', '2026-11-23'), true)
  assert.equal(inReleaseWindow('2025-11-23', '2026-11-23'), false)
  assert.equal(inReleaseWindow('2027-02-01', '2026-11-23'), true)
  assert.equal(inReleaseWindow('2026', '2026-11-23'), true)
})

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

test('Deezer albums: every page read, foreign links skipped, an error body is "did not answer"', async () => {
  const pages: Record<string, unknown> = {
    'https://api.deezer.com/artist/630/albums?limit=100': {
      data: [
        { title: 'Fossora', release_date: '2022-09-30', link: 'https://www.deezer.com/album/1' },
        { title: 'Odd', release_date: '2022-01-01', link: 'https://evil.example/album/2' },
      ],
      next: 'https://api.deezer.com/artist/630/albums?limit=100&index=100',
    },
    'https://api.deezer.com/artist/630/albums?limit=100&index=100': {
      data: [{ title: 'Vulnicura', release_date: '2015-01-20', link: 'https://www.deezer.com/album/3' }],
    },
    'https://api.deezer.com/artist/999/albums?limit=100': { error: { type: 'Exception', message: 'Quota limit exceeded' } },
  }
  const fetcher = async (url: string) => json(pages[url])
  const both = await deezerAlbums(['630', '999'], fetcher)
  assert.deepEqual(both.albums.map((album) => album.title), ['Fossora', 'Vulnicura'])
  assert.equal(both.answered, false)
  assert.equal((await deezerAlbums(['630'], fetcher)).answered, true)
  assert.deepEqual(await deezerAlbums([], fetcher), { albums: [], answered: true })
})

test('release checks: stale ones read again, fresh ones kept, a failed read keeps the old one, at most `max`', async () => {
  const now = Date.parse('2026-11-23T00:00:00Z')
  const old = new Date(now - CHECK_TTL_MS - 1).toISOString()
  const recent = new Date(now - 60_000).toISOString()
  const cache: CheckCache = {
    stale: { official: false, links: {}, documented: false, at: old },
    fresh: { official: true, links: {}, documented: true, at: recent },
    busy: { official: true, links: {}, documented: true, at: old },
  }
  const asked: string[] = []
  const fetcher = async (url: string) => {
    const id = new URL(url).searchParams.get('release-group') ?? ''
    asked.push(id)
    if (id === 'busy') return json({ error: 'The MusicBrainz web server is currently busy.' })
    return json({ releases: [{ status: 'Official', date: '2026-10-01', relations: [{ type: 'discogs', url: { resource: 'https://www.discogs.com/release/1' } }] }] })
  }
  const next = await refreshChecks(['stale', 'fresh', 'busy', 'new', 'new'], cache, fetcher, async () => {}, now)
  assert.deepEqual(asked, ['stale', 'busy', 'new'])
  assert.equal(next.stale.official, true)
  assert.equal(next.stale.at, new Date(now).toISOString())
  assert.equal(next.fresh, cache.fresh)
  assert.equal(next.busy, cache.busy)
  assert.deepEqual(next.new, { official: true, links: {}, documented: true, date: '2026-10-01', at: new Date(now).toISOString() })
  assert.equal(cache.stale.official, false) // the cache passed in is untouched

  asked.length = 0
  await refreshChecks(['a', 'b', 'c'], {}, fetcher, async () => {}, now, 2)
  assert.deepEqual(asked, ['a', 'b'])
})

test('a busy MusicBrainz (503 after the patient retries, or no answer) ends the checks for that artist', async () => {
  const now = Date.parse('2026-11-24T00:00:00Z')
  const asked: string[] = []
  const answers: Record<string, Response | null> = {
    a: json({ releases: [{ status: 'Official', date: '2026-10-01', barcode: '012345678905' }] }),
    b: new Response('busy', { status: 503 }),
  }
  const fetcher = async (url: string) => {
    const id = new URL(url).searchParams.get('release-group') ?? ''
    asked.push(id)
    return id in answers ? answers[id] : json({ releases: [] })
  }
  const next = await refreshChecks(['a', 'b', 'c', 'd'], {}, fetcher, async () => {}, now)
  assert.deepEqual(asked, ['a', 'b'])
  assert.deepEqual(Object.keys(next), ['a'])

  asked.length = 0
  answers.a = null
  await refreshChecks(['a', 'b'], {}, fetcher, async () => {}, now)
  assert.deepEqual(asked, ['a'])

  asked.length = 0
  answers.a = new Response('gone', { status: 404 })
  await refreshChecks(['a', 'c'], {}, fetcher, async () => {}, now)
  assert.deepEqual(asked, ['a', 'c'], 'a 404 is an answer about that group, not a busy server')
})

test('an Apple Music link from MusicBrainz counts only when the album is in the artist’s own Apple catalogue', () => {
  const linked = official({ links: { appleMusic: 'https://music.apple.com/us/album/6819756090', spotify: 'https://open.spotify.com/album/0Ad99OHFX3OjhZ410joegz' } })
  const out = confirmRelease(mbItem('Björk Orkestral With the Hamrahlíð Choir', '2026-05-26'), linked, answered([], ['6833893635']))
  assert.deepEqual(out?.links, { spotify: 'https://open.spotify.com/album/0Ad99OHFX3OjhZ410joegz' })
  const listed = confirmRelease(mbItem('Björk Orkestral With the Hamrahlíð Choir', '2026-05-26'), linked, answered([], ['6819756090']))
  assert.equal(listed?.links?.appleMusic, 'https://music.apple.com/us/album/6819756090')
  assert.equal(listed?.href, 'https://music.apple.com/us/album/6819756090')
})

test('a MusicBrainz date years ahead is a typo: the same title and kind on Deezer date it', () => {
  const albums = [
    { title: 'Paradise', date: '2026-09-30', link: 'https://www.deezer.com/album/p', type: 'single' },
    { title: 'Paradise', date: '2019-01-01', link: 'https://www.deezer.com/album/old-album', type: 'album' },
  ]
  const sources = { ...answered(albums), today: '2026-11-23' }
  const out = confirmRelease(mbItem('Paradise', '2029-09-30'), official(), sources, 'Single')
  assert.equal(out?.date, '2026-09-30')
  assert.equal(out?.links?.deezer, 'https://www.deezer.com/album/p')
  // A real announcement a few months out is left alone.
  const soon = confirmRelease(mbItem('Paradise', '2027-02-19'), official(), sources, 'Single')
  assert.equal(soon?.date, '2027-02-19')
  assert.equal(soon?.links?.deezer, undefined)
})
