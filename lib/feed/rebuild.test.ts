/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/rebuild.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BACKGROUND_FUNCTION_PATH, builtToday, triggerRebuild } from './rebuild.ts'

const noSleep = async () => {}

test('builtToday: the UTC date decides, not an age window', () => {
  const now = new Date('2026-10-21T00:20:00.000Z')
  // Last night's 00:41 build is 23h39m old — under any 24h+ window, yet stale.
  assert.equal(builtToday('2026-10-20T00:41:00.000Z', now), false)
  // Built one minute into today: fresh for the whole day, so every hourly
  // tick after the first is a no-op and tomorrow's 00:20 tick rebuilds.
  assert.equal(builtToday('2026-10-21T00:01:00.000Z', now), true)
  assert.equal(builtToday('2026-10-21T00:19:59.000Z', now), true)
  // The tick at 23:20 still sees today's build as fresh.
  assert.equal(builtToday('2026-10-21T00:41:00.000Z', new Date('2026-10-21T23:20:00.000Z')), true)
  // Midnight flips it: the 00:20 tick the next day rebuilds.
  assert.equal(builtToday('2026-10-21T00:41:00.000Z', new Date('2026-10-22T00:20:00.000Z')), false)
})

test('triggerRebuild: a 202 on the first try is one attempt', async () => {
  const calls: string[] = []
  const result = await triggerRebuild('https://example.test', {
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url))
      return new Response(null, { status: 202 })
    }) as typeof fetch,
    sleepImpl: noSleep,
  })
  assert.deepEqual(result, { ok: true, status: 202, attempts: 1 })
  assert.deepEqual(calls, [`https://example.test${BACKGROUND_FUNCTION_PATH}`])
})

test('triggerRebuild: retries a dropped connection and a 5xx, stops at the first 2xx', async () => {
  let n = 0
  const result = await triggerRebuild('https://example.test', {
    attempts: 3,
    fetchImpl: (async () => {
      n++
      if (n === 1) throw new Error('connection reset')
      if (n === 2) return new Response(null, { status: 502 })
      return new Response(null, { status: 202 })
    }) as typeof fetch,
    sleepImpl: noSleep,
  })
  assert.deepEqual(result, { ok: true, status: 202, attempts: 3 })
  assert.equal(n, 3)
})

test('triggerRebuild: gives up after the attempts and reports the last status', async () => {
  const result = await triggerRebuild('https://example.test', {
    attempts: 2,
    fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
    sleepImpl: noSleep,
  })
  assert.deepEqual(result, { ok: false, status: 503, attempts: 2 })
})

test('triggerRebuild: a connection that never answers reports no status', async () => {
  let waited = 0
  const result = await triggerRebuild('https://example.test', {
    attempts: 2,
    fetchImpl: (async () => {
      throw new Error('timeout')
    }) as typeof fetch,
    sleepImpl: async (ms) => {
      waited += ms
    },
  })
  assert.deepEqual(result, { ok: false, status: null, attempts: 2 })
  // One backoff between the two attempts, none after the last.
  assert.equal(waited, 500)
})
