/**
 * A release opens itself on the listener's service when the feed
 * confirmed it there, else a labelled search (owner, Nov 23 2026).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/listen/services.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveListenHref } from './services.ts'

const links = {
  amazonMusic: 'https://music.amazon.com/albums/B0HNZRT4JL',
  youtubeMusic: 'https://music.youtube.com/playlist?list=OLAK5uy_kxotrr0UBs54oag6GEmyYhZHfylB4I3To',
}

test('a confirmed link for the chosen service opens the release, labelled "Open on"', () => {
  assert.deepEqual(resolveListenHref('amazonMusic', undefined, 'AURORA', 'Morning Shall Come', links), {
    kind: 'release',
    href: 'https://music.amazon.com/albums/B0HNZRT4JL',
    service: 'amazonMusic',
    label: 'Open on Amazon Music',
    rerouted: false,
  })
})

test('no confirmed link for the chosen service: a labelled search on that service, never another service', () => {
  const out = resolveListenHref('spotify', undefined, 'Björk', 'The Björk Sides: The B-Sides', links)
  assert.equal(out.kind, 'search')
  assert.equal(out.kind === 'search' && out.label, 'Search on Spotify')
  assert.equal(out.kind === 'search' && out.href.startsWith('https://open.spotify.com/search/'), true)
  assert.equal(resolveListenHref('amazonMusic', undefined, 'Björk', 'Fossora').kind, 'search')
})

test('the legacy "youtube" choice opens the YouTube Music album', () => {
  const out = resolveListenHref('youtube', undefined, 'Gorillaz', 'The Mountain', links)
  assert.equal(out.kind, 'release')
  assert.equal(out.kind === 'release' && out.href, links.youtubeMusic)
})

test('a confirmed absence from the service still shows its note, link or not', () => {
  const presence = { artistName: 'X', notOn: [{ platform: 'amazonMusic' as const, note: 'Not on Amazon Music — by choice.' }] }
  const out = resolveListenHref('amazonMusic', presence, 'X', 'Y', links)
  assert.equal(out.kind, 'absent')
})
