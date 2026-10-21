/**
 * MusicBrainz fetch for Discover stocking: a busy server (503/429) or a
 * dropped connection is retried, and a final failure is reported as
 * "unavailable" — never as "no such artist" (Oct 21, 2026: Actress,
 * Mndsgn and Ebo Taylor were skipped "not on MusicBrainz" mid-run while
 * all three resolve at score 100).
 *   node --test lib/discover/mbFetch.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMusicBrainzJson } from './mbFetch.ts'

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const scripted = (steps: (() => Response)[]) => {
  let calls = 0
  const fetchImpl = async () => {
    const step = steps[Math.min(calls, steps.length - 1)]
    calls++
    return step()
  }
  return { fetchImpl, calls: () => calls }
}

const noWait = async () => {}

test('returns the body on the first success', async () => {
  const s = scripted([() => reply(200, { artists: [{ name: 'Actress' }] })])
  const out = await fetchMusicBrainzJson('u', { fetchImpl: s.fetchImpl, wait: noWait })
  assert.deepEqual(out, { ok: true, body: { artists: [{ name: 'Actress' }] } })
  assert.equal(s.calls(), 1)
})

test('retries a 503 and then succeeds', async () => {
  const s = scripted([() => reply(503), () => reply(503), () => reply(200, { n: 1 })])
  const out = await fetchMusicBrainzJson('u', { fetchImpl: s.fetchImpl, wait: noWait })
  assert.deepEqual(out, { ok: true, body: { n: 1 } })
  assert.equal(s.calls(), 3)
})

test('retries a 429 and a thrown network error', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls++
    if (calls === 1) return reply(429)
    if (calls === 2) throw new Error('ECONNRESET')
    return reply(200, { n: 2 })
  }
  const out = await fetchMusicBrainzJson('u', { fetchImpl, wait: noWait })
  assert.deepEqual(out, { ok: true, body: { n: 2 } })
  assert.equal(calls, 3)
})

test('gives up after the last attempt and says unavailable', async () => {
  const s = scripted([() => reply(503)])
  const out = await fetchMusicBrainzJson('u', { fetchImpl: s.fetchImpl, wait: noWait, attempts: 3 })
  assert.deepEqual(out, { ok: false, unavailable: true })
  assert.equal(s.calls(), 3)
})

test('a 400 or 404 is not retried and is not "unavailable"', async () => {
  const s = scripted([() => reply(404)])
  const out = await fetchMusicBrainzJson('u', { fetchImpl: s.fetchImpl, wait: noWait })
  assert.deepEqual(out, { ok: false, unavailable: false })
  assert.equal(s.calls(), 1)
})

test('waits longer before each retry', async () => {
  const waits: number[] = []
  const s = scripted([() => reply(503)])
  await fetchMusicBrainzJson('u', {
    fetchImpl: s.fetchImpl,
    wait: async (ms) => {
      waits.push(ms)
    },
    attempts: 3,
  })
  assert.equal(waits.length, 2)
  assert.ok(waits[1] > waits[0])
})
