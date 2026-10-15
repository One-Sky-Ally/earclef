/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/discover/match.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { picksForRows } from './match.ts'
import type { DiscoverPick, DiscoverPool } from './generate.ts'

const pick = (mbid: string, connectsTo?: string[]): DiscoverPick => ({
  name: mbid,
  why: '',
  knownFor: '',
  knownForVerified: true,
  mbid,
  play: null,
  read: { kind: 'musicbrainz', url: `https://musicbrainz.org/artist/${mbid}` },
  listenHref: '',
  song: null,
  bandcamp: null,
  connectsTo,
})
const pool = (date: string, picks: DiscoverPick[]): DiscoverPool => ({ date, picks })

test('only picks connected to the listener’s rows, by slug — never by prose', () => {
  const today = pool('2026-10-15', [
    pick('a', ['radiohead']),
    pick('b', ['bjork']),
    pick('c'), // an older pool's pick with no connections
    pick('d', ['khruangbin', 'aurora']),
  ])
  const result = picksForRows([today], { radiohead: 'in-the-mix', aurora: 'on-the-radar' }, 12)
  assert.deepEqual(result.map((m) => m.pick.mbid), ['a', 'd'])
  assert.deepEqual(result[1].because, ['aurora'])
})

test('Heavy rotation outranks In the mix outranks On the radar; ties keep the set’s order', () => {
  const today = pool('2026-10-15', [
    pick('radar', ['aurora']),
    pick('mix', ['bjork']),
    pick('heavy', ['radiohead']),
    pick('mix2', ['bjork']),
  ])
  const tiers = { radiohead: 'heavy-rotation', bjork: 'in-the-mix', aurora: 'on-the-radar' } as const
  assert.deepEqual(
    picksForRows([today], tiers, 12).map((m) => m.pick.mbid),
    ['heavy', 'mix', 'mix2', 'radar'],
  )
})

test('fresher days lead at equal strength; an artist repeated across days appears once', () => {
  const today = pool('2026-10-15', [pick('fresh', ['bjork'])])
  const older = pool('2026-10-12', [pick('old', ['bjork']), pick('fresh', ['bjork'])])
  const result = picksForRows([today, older], { bjork: 'in-the-mix' }, 12)
  assert.deepEqual(result.map((m) => m.pick.mbid), ['fresh', 'old'])
})

test('the limit caps the list; no follows means no picks', () => {
  const today = pool('2026-10-15', Array.from({ length: 20 }, (_, i) => pick(`p${i}`, ['bjork'])))
  assert.equal(picksForRows([today], { bjork: 'in-the-mix' }, 12).length, 12)
  assert.deepEqual(picksForRows([today], {}, 12), [])
})
