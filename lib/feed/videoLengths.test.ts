/**
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/videoLengths.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchLengths, learnLengths } from './videoLengths.ts'

function fakeYouTube(durations: Record<string, string>, failing = new Set<number>()) {
  const calls: string[][] = []
  const fetchImpl = async (url: string | URL | Request) => {
    const ids = new URL(String(url)).searchParams.get('id')!.split(',')
    calls.push(ids)
    if (failing.has(calls.length)) return new Response('{}', { status: 403 })
    return Response.json({
      items: ids
        .filter((id) => id in durations)
        .map((id) => ({ id, contentDetails: { duration: durations[id] } })),
    })
  }
  return { calls, fetchImpl: fetchImpl as typeof fetch }
}

test('fetchLengths: one videos.list call per 50 ids, seconds back', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `v${i}`)
  const durations = Object.fromEntries(ids.map((id) => [id, 'PT2M']))
  const { calls, fetchImpl } = fakeYouTube(durations)
  const lengths = await fetchLengths(ids, 'key', fetchImpl)
  assert.deepEqual(
    calls.map((call) => call.length),
    [50, 50, 20],
  )
  assert.equal(Object.keys(lengths).length, 120)
  assert.equal(lengths.v7, 120)
})

test('fetchLengths: ids YouTube does not return stay unknown', async () => {
  const { fetchImpl } = fakeYouTube({ a: 'PT37S', c: 'P0D' })
  assert.deepEqual(await fetchLengths(['a', 'b', 'c'], 'key', fetchImpl), {
    a: 37,
    c: 0,
  })
})

test('fetchLengths: a failed call leaves its ids unknown, the rest stand', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `v${i}`)
  const durations = Object.fromEntries(ids.map((id) => [id, 'PT30S']))
  const { fetchImpl } = fakeYouTube(durations, new Set([1]))
  const lengths = await fetchLengths(ids, 'key', fetchImpl)
  assert.equal(Object.keys(lengths).length, 10)
  assert.equal(lengths.v55, 30)
})

test('fetchLengths: a thrown fetch is an unknown, never an error', async () => {
  const fetchImpl = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  assert.deepEqual(await fetchLengths(['a'], 'key', fetchImpl), {})
})

test('fetchLengths: passes its time limit to every call', async () => {
  const signals: (AbortSignal | null | undefined)[] = []
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    signals.push(init?.signal)
    return Response.json({ items: [] })
  }) as typeof fetch
  await fetchLengths(['a'], 'key', fetchImpl, 2500)
  assert.equal(signals.length, 1)
  assert.ok(signals[0] instanceof AbortSignal)
})

test('fetchLengths: nothing to ask, nothing spent', async () => {
  const { calls, fetchImpl } = fakeYouTube({})
  assert.deepEqual(await fetchLengths([], 'key', fetchImpl), {})
  assert.equal(calls.length, 0)
})

// learnLengths runs on the in-memory store here (no Netlify Blobs off
// Netlify) and asks YouTube through the global fetch, stubbed per test.
async function withFetch<T>(
  durations: Record<string, string>,
  run: (calls: string[][]) => Promise<T>,
): Promise<T> {
  const { calls, fetchImpl } = fakeYouTube(durations)
  const real = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = real
  }
}

test('learnLengths: asks once, then answers from what it remembered', async () => {
  await withFetch({ m1: 'PT45S', m2: 'PT3M' }, async (calls) => {
    assert.deepEqual(await learnLengths(['m1', 'm2', 'gone'], 2500, 'key'), {
      m1: 45,
      m2: 180,
    })
    assert.equal(calls.length, 1)
    // Remembered: no second call for m1/m2; only the unknown id is re-asked.
    assert.deepEqual(await learnLengths(['m1', 'm2', 'gone'], 2500, 'key'), {
      m1: 45,
      m2: 180,
    })
    assert.deepEqual(calls[1], ['gone'])
  })
})

test('learnLengths: no key, no calls — only what is remembered', async () => {
  await withFetch({ k1: 'PT2M' }, async (calls) => {
    assert.deepEqual(await learnLengths(['k1'], 2500, undefined), {})
    assert.equal(calls.length, 0)
  })
})
