/**
 * The shape of Discover "Played" marks and the rules for combining them,
 * shared by the browser copy (./played) and the account copy
 * (lib/fans/store.ts). No I/O here.
 *
 * Per artist: the MusicBrainz id, the day it was first marked, and how
 * — pressing play on a Discover song, or marking it by hand. Nothing
 * else: no song, no time of day, no count.
 */

export type PlayedHow = 'play' | 'hand'

export interface PlayedMark {
  /** YYYY-MM-DD, the day it was first marked. */
  on: string
  how: PlayedHow
}

export type PlayedMarks = Record<string, PlayedMark>

/** Far more than Discover recommends in a year; keeps storage bounded. */
export const MAX_PLAYED = 3000

export const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Storage and request bodies are user-editable: what comes out is input. */
export function sanitizeMarks(raw: unknown): PlayedMarks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const marks: PlayedMarks = {}
  let n = 0
  for (const [mbid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_PLAYED) break
    const mark = sanitizeMark(mbid, value)
    if (!mark) continue
    marks[mbid] = mark
    n++
  }
  return marks
}

export function sanitizeMark(mbid: unknown, value: unknown): PlayedMark | null {
  if (typeof mbid !== 'string' || !MBID.test(mbid) || !value || typeof value !== 'object') {
    return null
  }
  const { on, how } = value as { on?: unknown; how?: unknown }
  if (typeof on !== 'string' || !DATE.test(on)) return null
  return { on, how: how === 'hand' ? 'hand' : 'play' }
}

/** Keeps the newest MAX_PLAYED marks (an old mark is the cheapest to lose). */
function bounded(marks: PlayedMarks): PlayedMarks {
  const entries = Object.entries(marks)
  if (entries.length <= MAX_PLAYED) return marks
  entries.sort(([, a], [, b]) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0))
  return Object.fromEntries(entries.slice(0, MAX_PLAYED))
}

/** Adds a mark; an artist already marked keeps its first mark. */
export function withMark(marks: PlayedMarks, mbid: string, mark: PlayedMark): PlayedMarks {
  if (marks[mbid]) return marks
  return bounded({ ...marks, [mbid]: mark })
}

export function withoutMark(marks: PlayedMarks, mbid: string): PlayedMarks {
  if (!marks[mbid]) return marks
  const rest = { ...marks }
  delete rest[mbid]
  return rest
}

/**
 * Folds marks made elsewhere (e.g. before signing in) into a list. Both
 * sides' artists are kept; where both have one, the earlier day wins.
 */
export function mergeMarks(current: PlayedMarks, incoming: PlayedMarks): PlayedMarks {
  const merged: PlayedMarks = { ...current }
  for (const [mbid, mark] of Object.entries(incoming)) {
    const had = merged[mbid]
    if (!had || mark.on < had.on) merged[mbid] = mark
  }
  return bounded(merged)
}
