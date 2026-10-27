/**
 * Discogs reads for Discover songs must tell a failed call apart from an
 * empty answer: on Oct 27, 2026 a burst of picks with plenty of official
 * videos (Phantogram, XTC) was skipped "no playable song" in seconds,
 * and a re-run found their songs at once.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/play/discogsApi.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discogsArtistRecords, discogsReleaseLabels } from './discogsApi.ts'

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const listing = {
  releases: [{ id: 11, title: 'Album', type: 'master', role: 'Main', year: 2009 }],
}

async function withFetch<T>(route: (path: string) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) =>
    route(new URL(String(input)).pathname)) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const read = () => discogsArtistRecords([1], { deadline: Date.now() + 60_000, maxRecords: 1 })

test('a clean read with no videos is not a failure', async () => {
  const out = await withFetch(
    (path) => (path.startsWith('/artists/') ? json(200, listing) : json(200, { title: 'Album', videos: [] })),
    read,
  )
  assert.equal(out.records.length, 0)
  assert.equal(out.failed, false)
})

test('a server error on a record read is reported as failed', async () => {
  const out = await withFetch(
    (path) => (path.startsWith('/artists/') ? json(200, listing) : json(503)),
    read,
  )
  assert.equal(out.records.length, 0)
  assert.equal(out.failed, true)
})

test('a failed artist listing is reported as failed', async () => {
  const out = await withFetch(() => json(502), read)
  assert.equal(out.failed, true)
})

test('a 404 is an answer (gone from Discogs), not a failure', async () => {
  const out = await withFetch(
    (path) => (path.startsWith('/artists/') ? json(200, listing) : json(404)),
    read,
  )
  assert.equal(out.failed, false)
})

test('a dropped connection is reported as failed', async () => {
  const out = await withFetch(() => {
    throw new TypeError('fetch failed')
  }, read)
  assert.equal(out.failed, true)
})

const twoAlbums = {
  releases: [
    { id: 11, title: 'First', type: 'master', role: 'Main', year: 2010 },
    { id: 12, title: 'Second', type: 'master', role: 'Main', year: 2008 },
  ],
}
const albumBody = (path: string) => ({
  id: Number(path.split('/').pop()),
  title: path.endsWith('/11') ? 'First' : 'Second',
  artists: [{ id: 1 }],
  videos: [{ uri: `https://www.youtube.com/watch?v=${path.endsWith('/11') ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb'}`, title: 'Song' }],
})

test('an early stop says so, and a second read skips what was read', async () => {
  const route = (path: string) => (path.startsWith('/artists/') ? json(200, twoAlbums) : json(200, albumBody(path)))
  const first = await withFetch(route, () =>
    discogsArtistRecords([1], { deadline: Date.now() + 60_000, enough: (records) => records.length >= 1 }),
  )
  assert.deepEqual(first.records.map((record) => record.id), [11])
  assert.equal(first.stoppedEarly, true)
  const rest = await withFetch(route, () =>
    discogsArtistRecords([1], { deadline: Date.now() + 60_000, skip: new Set(first.read) }),
  )
  assert.deepEqual(rest.records.map((record) => record.id), [12])
  assert.equal(rest.stoppedEarly, false)
})

test("a master keeps its main release id, and that pressing's labels can be read", async () => {
  const route = (path: string) =>
    path.startsWith('/artists/')
      ? json(200, listing)
      : path === '/releases/99'
        ? json(200, { id: 99, labels: [{ name: 'Brownswood Recordings' }, { name: 'Brownswood Recordings' }] })
        : json(200, { id: 11, title: 'Album', main_release: 99, artists: [{ id: 1 }], videos: [{ uri: 'https://youtu.be/aaaaaaaaaaa', title: 'Song' }] })
  const out = await withFetch(route, read)
  assert.equal(out.records[0]?.mainRelease, 99)
  const labels = await withFetch(route, () => discogsReleaseLabels([99], { deadline: Date.now() + 60_000 }))
  assert.deepEqual(labels, { labels: ['Brownswood Recordings'], failed: false })
  const down = await withFetch(() => json(503), () => discogsReleaseLabels([99], { deadline: Date.now() + 60_000 }))
  assert.deepEqual(down, { labels: [], failed: true })
})
