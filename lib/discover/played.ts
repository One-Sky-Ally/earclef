/**
 * Discover "Played" marks in the browser (owner, Nov 23 2026).
 *
 * SIGNED OUT: the marks live only here, in localStorage, and are never
 * sent anywhere.
 * SIGNED IN: they are saved to the account (lib/fans/store.ts
 * `discoverPlayed`, via /api/fan/played) so they follow the listener to
 * any device; this browser keeps a copy so pages show them straight away.
 *
 * Two lists, like liked songs (lib/fans/likesStorage.ts):
 * - the CACHE: what to paint, and the whole truth while signed out;
 * - PENDING: marks the account has never confirmed (made while signed
 *   out, or whose save failed). Only these are merged into the account,
 *   so an artist un-marked on one device is not brought back by
 *   another device's stale cache.
 */
import {
  MBID,
  mergeMarks,
  sanitizeMarks,
  withMark,
  withoutMark,
  type PlayedHow,
  type PlayedMarks,
} from './playedMarks'

export type { PlayedHow, PlayedMark, PlayedMarks } from './playedMarks'

const STORAGE_KEY = 'earclef_discover_played'
const PENDING_KEY = 'earclef_discover_played_pending'
const CHANGE_EVENT = 'earclef:discover-played'
const API = '/api/fan/played'

/** The stored text as is (a stable value for useSyncExternalStore), or null. */
export function readPlayedRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function parsePlayed(raw: string | null): PlayedMarks {
  try {
    return raw ? sanitizeMarks(JSON.parse(raw)) : {}
  } catch {
    // Corrupt JSON: nothing marked here.
    return {}
  }
}

export function readPlayed(): PlayedMarks {
  // Private mode or blocked storage reads as null: nothing marked here.
  return parsePlayed(readPlayedRaw())
}

function readPending(): PlayedMarks {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? sanitizeMarks(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function store(key: string, marks: PlayedMarks): void {
  try {
    if (Object.keys(marks).length === 0 && key === PENDING_KEY) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(marks))
  } catch {
    // Quota or private mode: the mark just won't outlast this page.
  }
}

function writeCache(marks: PlayedMarks): void {
  store(STORAGE_KEY, marks)
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // No window (server render): nothing to tell.
  }
}

/** Known after the first sync of this page: is someone signed in? */
let signedIn: boolean | null = null
let syncing: Promise<void> | null = null

async function send(body: unknown): Promise<PlayedMarks | null> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    signedIn = false
    return null
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { marks?: unknown }
  return sanitizeMarks(data.marks)
}

/**
 * Once per page: when signed in, hands the account any marks it has
 * never seen, then takes the account's list as this browser's copy.
 * Signed out (or offline), the browser's own list stands.
 */
export function syncPlayed(): Promise<void> {
  syncing ??= (async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { signedIn?: boolean; marks?: unknown }
      if (data.signedIn !== true) {
        signedIn = false
        return
      }
      signedIn = true
      let account = sanitizeMarks(data.marks)
      const pending = readPending()
      if (Object.keys(pending).length > 0) {
        const merged = await send({ merge: pending })
        if (merged) {
          account = merged
          store(PENDING_KEY, {})
        } else {
          account = mergeMarks(account, pending)
        }
      }
      writeCache(account)
    } catch {
      // Offline or the account is unreachable: keep what this browser has.
    }
  })()
  return syncing
}

const today = () => new Date().toISOString().slice(0, 10)

/** Marks an artist as played. An earlier mark keeps its date. */
export function markPlayed(mbid: string, how: PlayedHow = 'play'): void {
  if (!MBID.test(mbid)) return
  const cache = readPlayed()
  if (cache[mbid]) return
  const mark = { on: today(), how }
  writeCache(withMark(cache, mbid, mark))
  store(PENDING_KEY, withMark(readPending(), mbid, mark))
  void (async () => {
    await syncPlayed()
    if (!signedIn) return
    try {
      if (await send({ mbid, mark })) store(PENDING_KEY, withoutMark(readPending(), mbid))
    } catch {
      // Stays pending: the next page's sync hands it over.
    }
  })()
}

/** Takes the mark off (the listener's own correction), here and in the account. */
export function unmarkPlayed(mbid: string): void {
  const cache = readPlayed()
  if (!cache[mbid]) return
  writeCache(withoutMark(cache, mbid))
  store(PENDING_KEY, withoutMark(readPending(), mbid))
  void (async () => {
    await syncPlayed()
    if (!signedIn) return
    try {
      await send({ mbid, played: false })
    } catch {
      // The account still has it; the next sync shows it again, honestly.
    }
  })()
}

/** Calls back when the marks change, in this tab or another. */
export function onPlayedChange(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) callback()
  }
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}
