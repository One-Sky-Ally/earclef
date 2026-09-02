/**
 * Liked songs in the browser — the copy that exists before anyone signs
 * in, and the offline mirror after. Every read goes back through the
 * same gate the API uses: localStorage is user-editable, so what comes
 * out of it is input, never trusted state.
 *
 * TWO lists, because they answer different questions:
 *
 * - the CACHE is what to paint immediately, and the whole truth while
 *   signed out;
 * - PENDING is the much shorter list of likes the server has never
 *   confirmed — made while signed out, or whose POST failed.
 *
 * Only PENDING is ever merged into the fan record. Merging the cache
 * instead would resurrect the dead: unlike a song on your phone, and
 * the laptop's stale cache would push it straight back on next load.
 * A like that the server has already acknowledged is never pending, so
 * it is never re-sent, so a deliberate removal stays removed.
 */
import {
  MAX_LIKES,
  byNewestFirst,
  sanitizeLikedTrack,
  type LikedTrack,
} from './likes'

const STORAGE_KEY = 'earclef_likes'
const PENDING_KEY = 'earclef_likes_pending'
const RADAR_KEY = 'earclef_radar_dismissed'

function readList(key: string): LikedTrack[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed
      .slice(0, MAX_LIKES)
      .map((entry) => sanitizeLikedTrack(entry, now))
      .filter((track): track is LikedTrack => track !== null)
      .sort(byNewestFirst)
  } catch {
    // Private mode, disabled storage, corrupt JSON — all mean "no likes
    // here", which is a perfectly workable state.
    return []
  }
}

/** Best-effort persistence: a storage failure must never lose the like
 * from the running page, only from the next visit. */
function writeList(key: string, likes: LikedTrack[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(likes.slice(0, MAX_LIKES)))
  } catch {
    // Quota or private mode; the in-memory list still carries the session.
  }
}

/** Saved likes held in this browser, newest first. Never throws. */
export function readStoredLikes(): LikedTrack[] {
  return readList(STORAGE_KEY)
}

export function writeStoredLikes(likes: LikedTrack[]): void {
  writeList(STORAGE_KEY, likes)
}

/** Likes the server has never confirmed — the only ones ever merged. */
export function readPendingLikes(): LikedTrack[] {
  return readList(PENDING_KEY)
}

export function writePendingLikes(likes: LikedTrack[]): void {
  writeList(PENDING_KEY, likes)
}

/**
 * Artists taken off the derived radar, in this browser. Ids only — the
 * radar tier itself is recomputed from the likes and never stored.
 */
export function readDismissedRadar(): string[] {
  try {
    const raw = localStorage.getItem(RADAR_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is string => typeof entry === 'string',
    )
  } catch {
    return []
  }
}

export function writeDismissedRadar(mbids: string[]): void {
  try {
    localStorage.setItem(RADAR_KEY, JSON.stringify(mbids))
  } catch {
    // Private mode; the in-memory list still carries the session.
  }
}
