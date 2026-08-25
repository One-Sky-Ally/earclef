/**
 * Shared fetch/caching primitives for the held-ruling re-run.
 *
 * Kept separate from the phase logic so the pacing, retry and
 * degraded-response rules live in exactly one place: a 200 that omits
 * the key we are reading is NOT "no data" (lesson 5) — it is transient
 * and must be retried, never recorded as an absence.
 */
const UA = 'EarClefHeldRerun/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const MB_DELAY_MS = 1150

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(url, { headers = {}, timeout = 15000, tries = 4 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      })
      if (res.status === 404) return null
      if (res.status === 429 || res.status === 503) {
        await sleep(2500 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      if (attempt === tries) throw error
      await sleep(2500 * attempt)
    }
  }
  throw new Error('retries exhausted')
}

/** MusicBrainz JSON with pacing. `expect` guards degraded 200s. */
export async function mbJson(url, expect = null) {
  const body = await request(url)
  await sleep(MB_DELAY_MS)
  if (body && expect && !(expect in body)) {
    throw new Error(`degraded MB response (no ${expect} key)`)
  }
  return body
}

export async function wdJson(url) {
  const body = await request(url, { timeout: 25000 })
  await sleep(400)
  return body
}

export async function discogsJson(url, token) {
  const body = await request(url, {
    headers: { Authorization: `Discogs token=${token}` },
    timeout: 15000,
  })
  await sleep(1100)
  return body
}

/** Every Discogs ARTIST id an MB url-rels payload points at. */
export function discogsIdsFrom(relations) {
  const ids = new Set()
  for (const relation of relations ?? []) {
    const resource = relation.url?.resource ?? ''
    const match = /discogs\.com\/artist\/(\d+)/.exec(resource)
    if (match) ids.add(match[1])
  }
  return [...ids]
}

export function wikidataQidFrom(relations) {
  const relation = (relations ?? []).find((entry) => entry.type === 'wikidata')
  const resource = relation?.url?.resource ?? ''
  const match = /(Q\d+)/.exec(resource)
  return match ? match[1] : null
}
