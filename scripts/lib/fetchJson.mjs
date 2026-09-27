/**
 * JSON over HTTP with a hard per-attempt timeout and bounded retries.
 *
 * WDQS stalled for hours on Sep 20, 2026 and the sweep's old getJson
 * had no timeout, so one stuck request froze the whole run. Every
 * attempt now aborts after `timeoutMs` (the body read included — a
 * response that stalls or truncates mid-stream counts as a failed
 * attempt and is retried). When the retries run out it THROWS: the
 * caller skips that unit of work and a rerun retries it; a failure is
 * never turned into an empty answer.
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function getJson(
  url,
  headers,
  { tries = 3, timeoutMs = 90_000, backoffMs = 1000, fetchImpl = fetch, sleep = defaultSleep } = {},
) {
  let lastError = null
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
      if (res.status === 429 || res.status === 503) {
        lastError = new Error(`HTTP ${res.status}`)
        await res.body?.cancel().catch(() => {})
        if (attempt < tries) await sleep(3 * backoffMs * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      lastError = error
      if (attempt < tries) await sleep(2 * backoffMs * attempt)
    }
  }
  throw new Error(`gave up after ${tries} tries: ${lastError?.message ?? 'unknown error'}`, {
    cause: lastError,
  })
}
