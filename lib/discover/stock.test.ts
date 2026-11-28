/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/stock.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  appendOwner,
  appendShared,
  ownerSetFor,
  recentSharedIds,
  setsToAdd,
  sharedReady,
  sharedSetFor,
  sharedThrough,
  SHARED_KEEP_DAYS,
} from './stock.ts'

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

test('no stock means no shared set — the caller falls back, never shows an empty row', () => {
  assert.equal(sharedSetFor(null, '2026-10-20'), null)
})

test('the first fill starts today and runs one set a day', () => {
  const { index } = appendShared(null, ids('s', 14), '2026-10-20')
  assert.deepEqual(sharedSetFor(index, '2026-10-20'), { id: 's1', archive: false })
  assert.deepEqual(sharedSetFor(index, '2026-11-02'), { id: 's14', archive: false })
  assert.equal(sharedReady(index, '2026-10-20'), 13)
  assert.equal(sharedThrough(index), '2026-11-02')
})

test('run out → earlier sets come back oldest first, labelled from the archive', () => {
  const { index } = appendShared(null, ids('s', 3), '2026-10-20')
  assert.deepEqual(sharedSetFor(index, '2026-10-23'), { id: 's1', archive: true })
  assert.deepEqual(sharedSetFor(index, '2026-10-24'), { id: 's2', archive: true })
  assert.deepEqual(sharedSetFor(index, '2026-10-26'), { id: 's1', archive: true })
  assert.equal(sharedReady(index, '2026-10-25'), 0)
})

test('a refresh after a run-out keeps the archive days as shown and starts fresh sets today', () => {
  const first = appendShared(null, ids('s', 3), '2026-10-20').index
  // 2026-10-23 and -24 were served s1, s2 from the archive; today is the 25th.
  const shownOn24 = sharedSetFor(first, '2026-10-24')
  const { index } = appendShared(first, ['t1', 't2'], '2026-10-25')
  assert.deepEqual(sharedSetFor(index, '2026-10-24'), shownOn24)
  assert.deepEqual(sharedSetFor(index, '2026-10-25'), { id: 't1', archive: false })
  assert.deepEqual(sharedSetFor(index, '2026-10-26'), { id: 't2', archive: false })
})

test('a top-up before running out queues behind the sets already planned', () => {
  const first = appendShared(null, ids('s', 14), '2026-10-20').index
  const { index } = appendShared(first, ids('t', 14), '2026-10-27')
  assert.deepEqual(sharedSetFor(index, '2026-11-02'), { id: 's14', archive: false })
  assert.deepEqual(sharedSetFor(index, '2026-11-03'), { id: 't1', archive: false })
  assert.equal(sharedReady(index, '2026-10-27'), 20)
})

test('days older than the keep window are trimmed and their sets released', () => {
  const first = appendShared(null, ids('s', 100), '2026-01-01').index
  const today = addDays('2026-01-01', SHARED_KEEP_DAYS + 5)
  const { index, dropped } = appendShared(first, ['new'], today)
  assert.equal(index.startDate, addDays('2026-01-01', 5))
  assert.deepEqual(dropped, ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(sharedSetFor(index, today), { id: 's96', archive: false })
})

test('recent ids walk back from today, each set once', () => {
  const { index } = appendShared(null, ids('s', 2), '2026-10-20')
  assert.deepEqual(recentSharedIds(index, '2026-10-23', 14), ['s2', 's1'])
})

test('owner: a fresh set on the first visit of a day, the same set all day, nothing used on days away', () => {
  let index = appendOwner(null, ids('o', 3)).index
  const day1 = ownerSetFor(index, '2026-10-20')
  assert.equal(day1.id, 'o1')
  assert.equal(day1.changed, true)
  index = day1.index!
  const again = ownerSetFor(index, '2026-10-20')
  assert.equal(again.id, 'o1')
  assert.equal(again.changed, false)
  const later = ownerSetFor(index, '2026-10-27')
  assert.equal(later.id, 'o2')
  assert.deepEqual(later.index!.seen, [{ date: '2026-10-20', id: 'o1' }])
})

test('owner: when the list runs out there is no set (the page shows the shared picks)', () => {
  let index = appendOwner(null, ['o1']).index
  index = ownerSetFor(index, '2026-10-20').index!
  assert.equal(ownerSetFor(index, '2026-10-21').id, null)
  assert.equal(ownerSetFor(appendOwner(index, ['o2']).index, '2026-10-21').id, 'o2')
})

test('refresh sizes: about two weeks first, then growth toward the ceiling', () => {
  assert.equal(setsToAdd('shared', 0), 14)
  assert.equal(setsToAdd('shared', 7), 14)
  assert.equal(setsToAdd('shared', 53), 7)
  assert.equal(setsToAdd('shared', 60), 0)
  assert.equal(setsToAdd('owner', 0), 14)
  assert.equal(setsToAdd('owner', 20), 10)
})

test('re-verified songs replace stocked ones by artist and old video id; null takes the song away (Nov 24, 2026)', async () => {
  const { replacePickSongs, songKey } = await import('./stock.ts')
  const song = (videoId: string, title: string) =>
    ({ videoId, title, uploadTitle: title, kind: 'official-video', source: 'discogs', uploader: 'x' }) as const
  const pick = (mbid: string, videoId: string, title: string) =>
    ({ name: mbid, mbid, song: song(videoId, title) }) as unknown as import('./types.ts').DiscoverPick
  const picks = [
    pick('mfp', 'aaaaaaaaaaa', 'I Dreamt I Was Dreaming'),
    pick('baebes', 'bbbbbbbbbbb', 'Live'),
    pick('mipso', 'ccccccccccc', 'Edges Run'),
    // A collaboration: another artist's pick shares the video.
    pick('partner', 'aaaaaaaaaaa', 'I Dreamt I Was Dreaming'),
  ]
  const out = replacePickSongs(
    picks,
    new Map([
      [songKey('mfp', 'aaaaaaaaaaa'), song('ddddddddddd', 'Light My Fire')],
      [songKey('baebes', 'bbbbbbbbbbb'), null],
    ]),
  )
  assert.deepEqual(out.picks.map((p) => p.song?.title ?? null), ['Light My Fire', null, 'Edges Run', 'I Dreamt I Was Dreaming'])
  assert.equal(out.replaced, 1)
  assert.equal(out.dropped, 1)
  assert.equal(out.picks[2], picks[2], 'untouched picks are the same objects')
  assert.equal(out.picks[3], picks[3], "a shared video never changes another artist's pick")
  assert.equal(picks[0].song?.title, 'I Dreamt I Was Dreaming', 'the input is not changed')
})

test('enrich gives every stocked pick of the artist their more songs and links, never the pick song again', async () => {
  const { enrichPicks, replacePickSongs, songKey, withoutDeadSongs } = await import('./stock.ts')
  const song = (videoId: string, title: string) =>
    ({ videoId, title, uploadTitle: title, kind: 'audio', source: 'channel', uploader: 'Rhye - Topic' }) as const
  const pick = (mbid: string, own: string) => ({
    name: 'Rhye',
    why: '',
    knownFor: 'Woman',
    knownForVerified: true,
    mbid,
    play: null,
    read: { kind: 'musicbrainz', url: `https://musicbrainz.org/artist/${mbid}` },
    listenHref: `https://musicbrainz.org/artist/${mbid}`,
    song: song(own, 'Open'),
    bandcamp: null,
  }) as const
  const rhye = 'aa914efa-d6cb-4816-906f-8edafb08418e'
  const other = '46713d05-4143-4704-a9c3-71b482a13944'
  const entries = new Map([
    [rhye, { more: [song('aaaaaaaaaaa', 'Open'), song('bbbbbbbbbbb', 'The Fall')], services: { spotify: 'https://open.spotify.com/artist/X' } }],
  ])
  const { picks, enriched } = enrichPicks([pick(rhye, 'aaaaaaaaaaa'), pick(other, 'zzzzzzzzzzz')], entries)
  assert.equal(enriched, 1)
  assert.deepEqual(picks[0].more?.map((entry) => entry.videoId), ['bbbbbbbbbbb'])
  assert.equal(picks[0].services?.spotify, 'https://open.spotify.com/artist/X')
  assert.equal(picks[1].more, undefined)

  // A replaced song leaves "more"; a dead one leaves it too, and a dead pick song goes.
  const replaced = replacePickSongs(picks, new Map([[songKey(rhye, 'aaaaaaaaaaa'), song('bbbbbbbbbbb', 'The Fall')]]))
  assert.deepEqual(replaced.picks[0].more, [])
  const dead = withoutDeadSongs(picks, new Set(['bbbbbbbbbbb', 'zzzzzzzzzzz']))
  assert.deepEqual(dead.picks[0].more, [])
  assert.equal(dead.picks[1].song, null)
  assert.equal(dead.songsDropped, 1)
  assert.equal(dead.moreDropped, 1)
})

test('the weekly re-check refreshes the upload title and channel kept from YouTube, nothing else', async () => {
  const { refreshSongFacts } = await import('./stock.ts')
  const song = { videoId: 'aaaaaaaaaaa', title: 'Open', uploadTitle: 'Rhye - Open', kind: 'audio', source: 'channel', uploader: 'Rhye' } as const
  const pick = {
    name: 'Rhye', why: '', knownFor: 'Woman', knownForVerified: true, mbid: 'aa914efa-d6cb-4816-906f-8edafb08418e',
    play: null, read: { kind: 'musicbrainz', url: 'https://musicbrainz.org/artist/x' }, listenHref: 'https://musicbrainz.org/artist/x',
    song, more: [{ ...song, videoId: 'bbbbbbbbbbb' }], bandcamp: null,
  } as const
  const { picks, refreshed } = refreshSongFacts([pick], new Map([
    ['aaaaaaaaaaa', { uploadTitle: 'Rhye - Open (Official Audio)', uploader: 'Rhye Official' }],
    ['bbbbbbbbbbb', { uploadTitle: 'Rhye - Open (Live)', uploader: 'Rhye Official' }],
  ]))
  assert.equal(refreshed, 2)
  assert.equal(picks[0].song?.uploadTitle, 'Rhye - Open (Official Audio)')
  assert.equal(picks[0].song?.title, 'Open')
  assert.equal(picks[0].more?.[0].uploader, 'Rhye Official')
  // Nothing new from YouTube: nothing counted, nothing to write.
  assert.equal(refreshSongFacts(picks, new Map([['aaaaaaaaaaa', { uploadTitle: 'Rhye - Open (Official Audio)', uploader: 'Rhye Official' }]])).refreshed, 0)
})
