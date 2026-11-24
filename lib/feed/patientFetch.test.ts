/**
 * MusicBrainz busy is not MusicBrainz's answer (Nov 24, 2026: real
 * releases left the feed when three tries in six seconds gave up).
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/feed/patientFetch.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithRetry, retryAfterMs, retryPlanFor } from './patientFetch.ts'

const MB = 'https://musicbrainz.org/ws/2/release-group?artist=x&fmt=json'

function scripted(statuses: (number | 'drop')[], headers: Record<string, string> = {}) {
  const calls: string[] = []
  const waits: number[] = []
  let n = 0
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    const status = statuses[Math.min(n++, statuses.length - 1)]
    if (status === 'drop') throw new TypeError('fetch failed')
    return new Response('{}', { status, headers })
  }) as typeof fetch
  const sleepImpl = async (ms: number) => {
    waits.push(ms)
  }
  return { calls, waits, fetchImpl, sleepImpl }
}

test('MusicBrainz gets five tries with growing waits before it counts as not answering', async () => {
  const run = scripted([503, 503, 503, 503, 503])
  const res = await fetchWithRetry(MB, run)
  assert.equal(res?.status, 503)
  assert.equal(run.calls.length, 5)
  assert.deepEqual(run.waits, [5000, 10000, 20000, 30000])
})

test('a busy MusicBrainz that recovers on the fourth try is an answer', async () => {
  const run = scripted([503, 429, 'drop', 200])
  const res = await fetchWithRetry(MB, run)
  assert.equal(res?.status, 200)
  assert.equal(run.calls.length, 4)
})

test("MusicBrainz's own Retry-After is honoured, up to a 30 s cap", async () => {
  const asked = scripted([503, 200], { 'retry-after': '12' })
  await fetchWithRetry(MB, asked)
  assert.deepEqual(asked.waits, [12000])
  const greedy = scripted([503, 200], { 'retry-after': '600' })
  await fetchWithRetry(MB, greedy)
  assert.deepEqual(greedy.waits, [30000])
})

test('other hosts keep three quick tries; a 404 is an answer, not retried', async () => {
  const apple = scripted([503, 503, 503])
  await fetchWithRetry('https://itunes.apple.com/lookup?id=1', apple)
  assert.equal(apple.calls.length, 3)
  assert.deepEqual(apple.waits, [2000, 4000])
  const gone = scripted([404])
  const res = await fetchWithRetry(MB, gone)
  assert.equal(res?.status, 404)
  assert.equal(gone.calls.length, 1)
})

test('every try dropped is null (not answering), never a verdict', async () => {
  const run = scripted(['drop'])
  assert.equal(await fetchWithRetry(MB, run), null)
  assert.equal(run.calls.length, 5)
})

test('Retry-After reads seconds and HTTP dates; anything else is ignored', () => {
  assert.equal(retryAfterMs('7'), 7000)
  assert.equal(retryAfterMs('Wed, 25 Nov 2026 00:21:00 GMT', Date.parse('2026-11-25T00:20:30Z')), 30000)
  assert.equal(retryAfterMs('soon'), null)
  assert.equal(retryAfterMs(null), null)
  assert.equal(retryPlanFor('https://coverartarchive.org/x').attempts, 3)
  assert.equal(retryPlanFor('https://beta.musicbrainz.org/ws/2/x').attempts, 5)
})

test('a batch fetcher never starts a request past the hard stop, and never waits past it', async () => {
  const { batchFetcher } = await import('./patientFetch.ts')
  let clock = 0
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    clock += 1000
    return new Response('busy', { status: 503 })
  }) as typeof fetch
  const fetcher = batchFetcher({
    hardStop: 12_000,
    retryBudgetMs: 10 * 60_000,
    fetchImpl,
    sleepImpl: async (ms) => {
      clock += ms
    },
    now: () => clock,
  })
  const res = await fetcher(MB)
  // try 1 at 0 s (ends 1 s), wait 5 s → try 2 at 6 s (ends 7 s); a 10 s wait would cross 12 s.
  assert.equal(calls.length, 2)
  assert.equal(res?.status, 503, 'the busy answer comes back: not answering, never a verdict')
  clock = 12_000
  assert.equal(await fetcher(MB), null, 'past the hard stop nothing starts')
  assert.equal(calls.length, 2)
})

test("a batch's retry waiting is one shared budget; the lock heartbeat runs at most once a minute", async () => {
  const { batchFetcher } = await import('./patientFetch.ts')
  let clock = 0
  let beats = 0
  const waits: number[] = []
  const fetcher = batchFetcher({
    hardStop: 60 * 60_000,
    retryBudgetMs: 20_000,
    fetchImpl: (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch,
    sleepImpl: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    now: () => clock,
    heartbeat: async () => {
      beats++
    },
  })
  await fetcher(MB) // waits 5 s + 10 s = 15 s; the next 20 s wait would overrun 20 s
  await fetcher(MB) // 5 s more fits exactly (20 s), then the budget is spent
  await fetcher(MB) // no waiting left: one try only
  assert.deepEqual(waits, [5000, 10000, 5000])
  assert.equal(beats, 0, 'under a minute of waiting: no heartbeat needed')
})
