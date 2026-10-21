/**
 * One MusicBrainz JSON request for Discover stocking, with retries.
 * A busy server (503/429) or a dropped connection is tried again after a
 * growing pause; a final failure comes back as `unavailable`, so callers
 * can tell "MusicBrainz did not answer" apart from "no such artist".
 */

const MB_USER_AGENT =
  'EarClefDiscover/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

const RETRY_STATUSES = new Set([429, 502, 503, 504])

export type MbFetchResult =
  | { ok: true; body: unknown }
  | { ok: false; unavailable: boolean }

export interface MbFetchOptions {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  wait?: (ms: number) => Promise<void>
  attempts?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function fetchMusicBrainzJson(
  url: string,
  { fetchImpl = fetch, wait = sleep, attempts = 4 }: MbFetchOptions = {},
): Promise<MbFetchResult> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await wait(2000 * (attempt - 1))
    let res: Response
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': MB_USER_AGENT } })
    } catch {
      continue // dropped connection: try again
    }
    if (res.ok) {
      try {
        return { ok: true, body: await res.json() }
      } catch {
        continue // truncated body: try again
      }
    }
    if (!RETRY_STATUSES.has(res.status)) return { ok: false, unavailable: false }
  }
  return { ok: false, unavailable: true }
}
