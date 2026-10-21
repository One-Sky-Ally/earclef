/**
 * The nightly rebuild's two small rules, kept free of the roster JSON so
 * they can be unit-tested with Node's runner (lib/feed/rebuild.test.ts):
 * the UTC-day freshness rule and the retried POST that every trigger
 * (hourly tick, self-chain, lazy route) sends to the background function.
 * snapshot.ts re-exports them; functions import from there.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Was this build stamped on today's UTC date? The day, not an age window:
 * the old "< 26h" check skipped every other nightly run (the 00:20 pass
 * finishes ~00:35, so at the next 00:20 the snapshot was ~23h40m old and
 * "fresh"). Any window longer than 24h minus the build time does the same.
 *
 * This is also what makes the hourly tick safe: once today's snapshot
 * exists, every further tick that day is a no-op, and a tick that finds
 * yesterday's keeps re-triggering until it is replaced.
 */
export function builtToday(builtAt: string, now: Date = new Date()): boolean {
  return builtAt.slice(0, 10) === now.toISOString().slice(0, 10)
}

/** The function every trigger POSTs. */
export const BACKGROUND_FUNCTION_PATH =
  '/.netlify/functions/feed-snapshot-background'

export interface TriggerResult {
  /** Netlify accepted the invocation (background functions answer 202). */
  ok: boolean
  /** Last HTTP status seen, or null when the last attempt never connected. */
  status: number | null
  attempts: number
}

export interface TriggerOptions {
  attempts?: number
  /** Per-attempt timeout; a background function answers in well under a second. */
  timeoutMs?: number
  /** Test seams. */
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

/**
 * POST the background rebuild and say whether Netlify accepted it. One
 * dropped request here used to end the night: the self-chain and the
 * scheduled tick each sent a single POST and took whatever came back, so
 * a transient 5xx or a hung connection left the snapshot stale until the
 * next trigger. Anything but a 2xx is retried with a short backoff.
 *
 * Callers MUST await this: a Netlify function can freeze the moment its
 * handler returns, abandoning an unawaited fetch mid-dispatch.
 */
export async function triggerRebuild(
  base: string,
  options: TriggerOptions = {},
): Promise<TriggerResult> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const timeoutMs = options.timeoutMs ?? 5000
  const doFetch = options.fetchImpl ?? fetch
  const wait = options.sleepImpl ?? sleep
  let status: number | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch(`${base}${BACKGROUND_FUNCTION_PATH}`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      })
      status = res.status
      if (res.ok) return { ok: true, status, attempts: attempt }
    } catch {
      status = null
    }
    if (attempt < attempts) await wait(500 * attempt)
  }
  return { ok: false, status, attempts }
}
