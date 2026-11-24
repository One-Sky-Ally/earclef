/**
 * Fetching for the nightly feed build, patient with MusicBrainz.
 *
 * Nov 24, 2026 (first live night of confirmed releases): MusicBrainz did
 * not answer the build for about six artists — three tries inside six
 * seconds gave up — and real releases (Bob Dylan, Michael Kiwanuka,
 * Imogen Heap) left the list. Owner: "Build the stronger MusicBrainz
 * retry so real releases don't come off when it's busy."
 *
 * MusicBrainz gets five tries over about a minute and a half, waiting as
 * long as its own Retry-After asks (capped); everyone else keeps the
 * short three-try wait. The build's batch deadline still bounds the total.
 *
 * Relative imports only: bundled into the Netlify background function.
 */

export interface RetryPlan {
  attempts: number
  /** Wait before try `attempt + 1`, given the server's Retry-After (seconds or an HTTP date). */
  delayMs: (attempt: number, retryAfter: string | null) => number
}

const MB_HOST = /^https:\/\/(?:[a-z0-9-]+\.)?musicbrainz\.org\//i
/** Never wait longer than this for one retry, whatever Retry-After says. */
const MAX_WAIT_MS = 30_000

/** Retry-After as milliseconds from now; null when absent or unreadable. */
export function retryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

export function retryPlanFor(url: string): RetryPlan {
  if (!MB_HOST.test(url)) {
    return { attempts: 3, delayMs: (attempt) => 2000 * attempt }
  }
  return {
    attempts: 5,
    // 5 s, 10 s, 20 s, 30 s — or longer when MusicBrainz asks, up to the cap.
    delayMs: (attempt, retryAfter) =>
      Math.min(MAX_WAIT_MS, Math.max(5000 * 2 ** (attempt - 1), retryAfterMs(retryAfter) ?? 0)),
  }
}

export interface FetchDeps {
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  timeoutMs?: number
  userAgent?: string
  /** False: no new try may start (the batch's hard stop has passed). */
  mayStart?: () => boolean
  /** False: this wait would overrun the batch's budget — give up on the call instead. */
  mayWait?: (ms: number) => boolean
  /** Called before each retry wait (the build refreshes its lock). */
  onWait?: () => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The response, or null when every try failed to connect. A 503/429 is
 * retried; any other status is returned as the answer it is.
 */
export async function fetchWithRetry(url: string, deps: FetchDeps = {}): Promise<Response | null> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleepImpl ?? realSleep
  const plan = retryPlanFor(url)
  let answer: Response | null = null
  for (let attempt = 1; attempt <= plan.attempts; attempt++) {
    if (deps.mayStart && !deps.mayStart()) return answer
    const last = attempt === plan.attempts
    let busy = false
    try {
      // A hung upstream must not eat the batch's 15 minutes.
      answer = await fetchImpl(url, {
        headers: deps.userAgent ? { 'User-Agent': deps.userAgent } : undefined,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      })
      busy = answer.status === 503 || answer.status === 429
      if (!busy || last) return answer
    } catch {
      if (last) return null
    }
    const wait = plan.delayMs(attempt, busy ? (answer?.headers.get('retry-after') ?? null) : null)
    if (deps.mayWait && !deps.mayWait(wait)) return busy ? answer : null
    await deps.onWait?.()
    await sleep(wait)
  }
  return answer
}

export interface BatchFetchOptions extends Pick<FetchDeps, 'fetchImpl' | 'sleepImpl' | 'timeoutMs' | 'userAgent'> {
  /** Epoch ms: no request starts after this, so the batch ends inside Netlify's 15 minutes. */
  hardStop: number
  /** Retry waiting the whole batch may spend, shared by every call. */
  retryBudgetMs: number
  /** Keeps the build's lock fresh through long waits (called at most once a minute). */
  heartbeat?: () => Promise<void>
  now?: () => number
}

const HEARTBEAT_EVERY_MS = 60_000

/**
 * One fetcher per batch: patient with a busy MusicBrainz, but never past
 * the batch's hard stop and never more retry waiting than its budget
 * (review, Nov 24 2026: five slow tries on every call could otherwise
 * run one artist past Netlify's limit and lose the batch).
 */
export function batchFetcher(options: BatchFetchOptions): (url: string) => Promise<Response | null> {
  const now = options.now ?? Date.now
  let waited = 0
  let beat = now()
  const deps: FetchDeps = {
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
    mayStart: () => now() < options.hardStop,
    mayWait: (ms) => {
      if (waited + ms > options.retryBudgetMs || now() + ms >= options.hardStop) return false
      waited += ms
      return true
    },
    onWait: async () => {
      if (!options.heartbeat || now() - beat < HEARTBEAT_EVERY_MS) return
      beat = now()
      await options.heartbeat()
    },
  }
  return (url) => fetchWithRetry(url, deps)
}
