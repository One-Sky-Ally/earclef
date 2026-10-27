/**
 * Discover song ranking over verified, playable candidates: official
 * video → trusted audio → trusted video; the pick's knownFor title wins
 * ties; whole-record uploads and untrusted non-official uploads are out.
 *   node --test lib/discover/song.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseSong, type RankedInput } from './song.ts'
import { aliasKeysOf } from '../play/titleVariants.ts'

const base = (over: Partial<RankedInput>): RankedInput => ({
  videoId: 'xxxxxxxxxxx',
  uploadTitle: 'Artist - Song',
  songTitle: 'Song',
  release: 'Album',
  source: 'discogs',
  uploader: 'Someone',
  playable: true,
  nonMusic: false,
  ...over,
})
const ctx = { name: 'Mipso', aliases: aliasKeysOf(['Mipso']), knownFor: 'Edges Run', labels: ['Rounder'] }

test('an official video wins over trusted audio, from any uploader', () => {
  const song = chooseSong(
    [
      base({ videoId: 'aaaaaaaaaaa', uploadTitle: 'Mipso - Edges Run (Official Audio)', songTitle: 'Edges Run', uploader: 'Mipso' }),
      base({ videoId: 'bbbbbbbbbbb', uploadTitle: 'Mipso - Hey, Coyote (Official Music Video)', songTitle: 'Hey, Coyote', uploader: 'MipsoVEVO' }),
    ],
    ctx,
  )
  assert.equal(song?.videoId, 'bbbbbbbbbbb')
  assert.equal(song?.kind, 'official-video')
  assert.equal(song?.title, 'Hey, Coyote')
})

test('without an official video, audio from a trusted uploader plays; a fan upload does not', () => {
  const fan = base({ videoId: 'ccccccccccc', uploadTitle: 'Mipso - Edges Run', songTitle: 'Edges Run', uploader: 'Norbert Tebarts' })
  assert.equal(chooseSong([fan], ctx), null)
  const topic = base({ videoId: 'ddddddddddd', uploadTitle: 'Edges Run', songTitle: 'Edges Run', uploader: 'Mipso - Topic' })
  const label = base({ videoId: 'eeeeeeeeeee', uploadTitle: 'Mipso - Coming Down the Mountain', songTitle: 'Coming Down the Mountain', uploader: 'Rounder' })
  const song = chooseSong([fan, label, topic], ctx)
  assert.equal(song?.videoId, 'ddddddddddd')
  assert.equal(song?.kind, 'audio')
})

test("the artist's own channel is trusted by construction", () => {
  const own = base({ videoId: 'fffffffffff', uploadTitle: 'Tisnant an Chatma', songTitle: 'Tisnant an Chatma', source: 'channel', uploader: 'Tamikrest official' })
  const song = chooseSong([own], { ...ctx, name: 'Tamikrest', aliases: aliasKeysOf(['Tamikrest']), labels: [] })
  assert.equal(song?.videoId, 'fffffffffff')
  assert.equal(song?.kind, 'video')
})

test('within a tier the knownFor title leads; unplayable, non-music and whole-record uploads never play', () => {
  const other = base({ videoId: 'ggggggggggg', uploadTitle: 'Mipso - Hey, Coyote (Official Video)', songTitle: 'Hey, Coyote' })
  const known = base({ videoId: 'hhhhhhhhhhh', uploadTitle: 'Mipso - Edges Run (Official Video)', songTitle: 'Edges Run' })
  assert.equal(chooseSong([other, known], ctx)?.videoId, 'hhhhhhhhhhh')
  assert.equal(chooseSong([base({ ...known, playable: false })], ctx), null)
  assert.equal(chooseSong([base({ ...known, nonMusic: true })], ctx), null)
  assert.equal(chooseSong([base({ uploadTitle: 'Mipso - Edges Run (Full Album) [Official Video]', songTitle: 'Edges Run' })], ctx), null)
})

test('a gone or forbidden channel is an answer; quota, server errors and drops are not', async () => {
  const { channelFailureIsTransient } = await import('./song.ts')
  const { QuotaError } = await import('../play/channelSongs.ts')
  assert.equal(channelFailureIsTransient(new Error('YouTube HTTP 404')), false)
  assert.equal(channelFailureIsTransient(new Error('YouTube 403')), false)
  assert.equal(channelFailureIsTransient(new QuotaError()), true)
  assert.equal(channelFailureIsTransient(new Error('YouTube HTTP 503')), true)
  assert.equal(channelFailureIsTransient(new TypeError('fetch failed')), true)
})

/** Discogs routes by path and YouTube videos.list by id, with env restored after. */
async function withMockedApis<T>(
  routes: Record<string, unknown>,
  uploaderOf: (videoId: string) => string,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch
  const saved = { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY, DISCOGS_TOKEN: process.env.DISCOGS_TOKEN }
  process.env.YOUTUBE_API_KEY = 'test'
  process.env.DISCOGS_TOKEN = 'test'
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.googleapis.com') {
      const items = (url.searchParams.get('id') ?? '').split(',').map((id) => ({
        id,
        snippet: { title: '', description: '', channelTitle: uploaderOf(id) },
        status: { embeddable: true, privacyStatus: 'public' },
        contentDetails: { duration: 'PT4M' },
      }))
      return new Response(JSON.stringify({ items }), { status: 200 })
    }
    const body = routes[url.pathname]
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 })
  }) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

const discogsArtist = [{ type: 'discogs', url: { resource: 'https://www.discogs.com/artist/1' } }]

test('a miss after an early stop reads on: fan uploads on the first album do not end the search', async () => {
  const { resolveDiscoverSong } = await import('./song.ts')
  const tracks = ['Edges Run', 'Hey Coyote', 'Louise', 'Bad Penny', 'Momma', 'People Change', 'Fine Thing', 'Marianne']
  const fanIds = tracks.map((_, i) => `fan${String(i).padStart(8, '0')}`)
  const officialId = 'official000'
  const routes = {
    '/artists/1/releases': {
      releases: [
        { id: 11, title: 'Edges Run', type: 'master', role: 'Main', year: 2017 },
        { id: 12, title: 'Coming Down the Mountain', type: 'master', role: 'Main', year: 2016 },
      ],
    },
    '/masters/11': {
      id: 11,
      title: 'Edges Run',
      artists: [{ id: 1 }],
      tracklist: tracks.map((title) => ({ title, type_: 'track' })),
      videos: tracks.map((title, i) => ({ uri: `https://www.youtube.com/watch?v=${fanIds[i]}`, title: `Mipso - ${title}` })),
    },
    '/masters/12': {
      id: 12,
      title: 'Coming Down the Mountain',
      artists: [{ id: 1 }],
      tracklist: [{ title: 'Water Runs Red', type_: 'track' }],
      videos: [{ uri: `https://www.youtube.com/watch?v=${officialId}`, title: 'Mipso - Water Runs Red (Official Video)' }],
    },
  }
  const song = await withMockedApis(routes, (id) => (id === officialId ? 'MipsoVEVO' : 'A Fan'), () =>
    resolveDiscoverSong({
      name: 'Mipso',
      knownFor: 'Edges Run',
      relations: discogsArtist,
      aliases: ['Mipso'],
      titles: ['Edges Run', 'Coming Down the Mountain'],
      deadline: Date.now() + 60_000,
      maxRecords: 25,
    }),
  )
  assert.equal(song?.videoId, officialId)
  assert.equal(song?.kind, 'official-video')
})

test("a label's own upload of a master-based album is trusted through the album's pressing", async () => {
  const { resolveDiscoverSong } = await import('./song.ts')
  // Discogs masters carry no label names: Brownswood's Black Focus uploads
  // read "uploader not trusted" (Yussef Kamaal, Oct 27 2026).
  const routes = {
    '/artists/1/releases': { releases: [{ id: 11, title: 'Black Focus', type: 'master', role: 'Main', year: 2016 }] },
    '/masters/11': {
      id: 11,
      title: 'Black Focus',
      main_release: 99,
      artists: [{ id: 1 }],
      tracklist: [{ title: 'Lowrider', type_: 'track' }, { title: "Mansur's Message", type_: 'track' }],
      videos: [
        { uri: 'https://www.youtube.com/watch?v=lowrider000', title: 'Yussef Kamaal - Lowrider' },
        { uri: 'https://www.youtube.com/watch?v=mansur00000', title: "Yussef Kamaal - Mansur's Message" },
      ],
    },
    '/releases/99': { id: 99, title: 'Black Focus', labels: [{ name: 'Brownswood Recordings' }] },
  }
  const song = await withMockedApis(routes, () => 'Brownswood Recordings', () =>
    resolveDiscoverSong({
      name: 'Yussef Kamaal',
      knownFor: 'Black Focus',
      relations: discogsArtist,
      aliases: ['Yussef Kamaal'],
      titles: ['Black Focus'],
      deadline: Date.now() + 60_000,
      maxRecords: 25,
    }),
  )
  assert.equal(song?.uploader, 'Brownswood Recordings')
  assert.equal(song?.title, 'Lowrider')
})

test('a search cut off by the run deadline is not a verdict', async () => {
  const { resolveDiscoverSong } = await import('./song.ts')
  const saved = process.env.YOUTUBE_API_KEY
  process.env.YOUTUBE_API_KEY = 'test'
  const unavailable: string[] = []
  try {
    const song = await resolveDiscoverSong({
      name: 'Mipso',
      knownFor: 'Edges Run',
      relations: discogsArtist,
      aliases: ['Mipso'],
      titles: ['Edges Run'],
      deadline: Date.now() - 1,
      onUnavailable: (where) => unavailable.push(where),
    })
    assert.equal(song, null)
    assert.deepEqual(unavailable, ['deadline'])
  } finally {
    if (saved === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = saved
  }
})
