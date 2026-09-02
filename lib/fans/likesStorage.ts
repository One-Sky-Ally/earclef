/**
 * Liked songs in the browser — the copy that exists before anyone signs
 * in, and the offline mirror after. Every read goes back through the
 * same gate the API uses: localStorage is user-editable, so what comes
 * out of it is input, never trusted state.
 */
import {
  MAX_LIKES,
  byNewestFirst,
  sanitizeLikedTrack,
  type LikedTrack,
} from './likes'

const STORAGE_KEY = 'earclef_likes'

/** Saved likes held in this browser, newest first. Never throws. */
export function readStoredLikes(): LikedTrack[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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
export function writeStoredLikes(likes: LikedTrack[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(likes.slice(0, MAX_LIKES)))
  } catch {
    // Quota or private mode; the in-memory list still carries the session.
  }
}
