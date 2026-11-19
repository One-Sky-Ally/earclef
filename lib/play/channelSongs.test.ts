/**
 * ytJson's quota verdict (owner, Nov 19 2026): YouTube refuses a search
 * over the project's "Search Queries per day" cap with HTTP 429
 * RESOURCE_EXHAUSTED, not the 403 quotaExceeded the daily unit quota
 * uses. Read as a plain error, it made the queue route answer 502 and
 * the player skip the artist — a capped day ended "No verified
 * recordings" instead of "come back tomorrow".
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/play/channelSongs.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QuotaError, ytJson } from './channelSongs.ts'

async function withResponse<T>(status: number, body: unknown, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const refusal = (code: number, status: string, reason: string) => ({
  error: { code, status, message: 'refused', errors: [{ reason }] },
})

test('the daily search cap (429 RESOURCE_EXHAUSTED) is a quota answer', async () => {
  await withResponse(429, refusal(429, 'RESOURCE_EXHAUSTED', 'rateLimitExceeded'), () =>
    assert.rejects(ytJson('https://example.test/search'), QuotaError),
  )
})

test('a 429 with no readable body is still a quota answer', async () => {
  await withResponse(429, 'not json', () => assert.rejects(ytJson('https://example.test/search'), QuotaError))
})

test('the daily unit quota (403 quotaExceeded) stays a quota answer', async () => {
  await withResponse(403, refusal(403, 'PERMISSION_DENIED', 'quotaExceeded'), () =>
    assert.rejects(ytJson('https://example.test/videos'), QuotaError),
  )
})

test('a forbidden resource is not a quota answer', async () => {
  await withResponse(403, refusal(403, 'PERMISSION_DENIED', 'forbidden'), async () => {
    const error = await ytJson('https://example.test/videos').catch((caught: unknown) => caught)
    assert.ok(error instanceof Error)
    assert.ok(!(error instanceof QuotaError))
    assert.equal(error.message, 'YouTube 403')
  })
})

test('server errors are not quota answers', async () => {
  await withResponse(503, {}, async () => {
    const error = await ytJson('https://example.test/videos').catch((caught: unknown) => caught)
    assert.ok(!(error instanceof QuotaError))
    assert.equal((error as Error).message, 'YouTube HTTP 503')
  })
})

test('a good answer passes through', async () => {
  await withResponse(200, { items: [1] }, async () => {
    assert.deepEqual(await ytJson('https://example.test/videos'), { items: [1] })
  })
})
