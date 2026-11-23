/**
 * A night MusicBrainz or Apple does not answer for an artist keeps the
 * releases last night's snapshot confirmed for them (Nov 23, 2026).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/carriedReleases.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carriedReleases, type SnapshotItem } from './snapshot.ts'

const row = (slug: string, title: string, extra: Partial<SnapshotItem> = {}): SnapshotItem => ({
  type: 'release',
  slug,
  artistName: slug,
  title,
  date: '2026-08-25',
  image: '',
  href: '',
  ...extra,
})

test('confirmed rows the artist lost tonight come back; nothing else does', () => {
  const previous = [
    row('sylvan-esso', 'On & On', { links: { deezer: 'https://www.deezer.com/album/1' } }),
    row('sylvan-esso', 'Concrete Glen', { links: {} }),
    row('sylvan-esso', 'Ow ∞', { links: { spotify: 'https://open.spotify.com/album/x' } }),
    row('sylvan-esso', 'Old Snapshot Row'), // built before the rule: no links field
    row('bjork', 'Fossora', { links: {} }),
    { ...row('sylvan-esso', 'A Video'), type: 'video' as const, links: {} },
  ]
  const fresh = [row('sylvan-esso', 'Ow ∞', { links: {} })]
  assert.deepEqual(
    carriedReleases('sylvan-esso', fresh, previous).map((item) => item.title),
    ['On & On', 'Concrete Glen'],
  )
  assert.deepEqual(carriedReleases('sylvan-esso', fresh, []), [])
})
