/**
 * Which Discover artists this listener has played — kept ONLY in this
 * browser (localStorage), never sent to the server, never counted,
 * never in the account (owner, Nov 23 2026: least identifying approach;
 * the privacy page says so). The trade-off: the marks don't follow the
 * listener to another device or browser, and clearing the site's data
 * clears them.
 *
 * Per artist: the MusicBrainz id, the day it was first marked, and how
 * — pressing play on a Discover song, or marking it by hand (plays from
 * before Nov 23 2026 were never remembered, so the listener can mark
 * those themselves). Nothing else: no song, no time of day, no count.
 */

export type PlayedHow = 'play' | 'hand'

export interface PlayedMark {
  /** YYYY-MM-DD, the day it was first marked. */
  on: string
  how: PlayedHow
}

export type PlayedMarks = Record<string, PlayedMark>

const STORAGE_KEY = 'earclef_discover_played'
const CHANGE_EVENT = 'earclef:discover-played'
/** Far more than Discover recommends in a year; keeps storage bounded. */
export const MAX_PLAYED = 3000

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** localStorage is user-editable: what comes out of it is input. */
export function sanitizeMarks(raw: unknown): PlayedMarks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const marks: PlayedMarks = {}
  let n = 0
  for (const [mbid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_PLAYED) break
    if (!MBID.test(mbid) || !value || typeof value !== 'object') continue
    const { on, how } = value as { on?: unknown; how?: unknown }
    if (typeof on !== 'string' || !DATE.test(on)) continue
    marks[mbid] = { on, how: how === 'hand' ? 'hand' : 'play' }
    n++
  }
  return marks
}

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

function write(marks: PlayedMarks): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks))
  } catch {
    // Quota or private mode: the mark just won't outlast this page.
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // No window (server render): nothing to tell.
  }
}

const today = () => new Date().toISOString().slice(0, 10)

/** Marks an artist as played. An earlier mark keeps its date. */
export function markPlayed(mbid: string, how: PlayedHow = 'play'): void {
  if (!MBID.test(mbid)) return
  const marks = readPlayed()
  if (marks[mbid]) return
  const kept = Object.keys(marks).length >= MAX_PLAYED ? trimOldest(marks) : marks
  write({ ...kept, [mbid]: { on: today(), how } })
}

/** Takes the mark off (the listener's own correction). */
export function unmarkPlayed(mbid: string): void {
  const marks = readPlayed()
  if (!marks[mbid]) return
  delete marks[mbid]
  write(marks)
}

function trimOldest(marks: PlayedMarks): PlayedMarks {
  const entries = Object.entries(marks).sort(([, a], [, b]) => (a.on < b.on ? 1 : -1))
  return Object.fromEntries(entries.slice(0, MAX_PLAYED - 1))
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
