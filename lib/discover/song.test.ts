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
