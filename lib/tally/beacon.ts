/**
 * Browser side of the anonymous counts (lib/tally/counts.ts). Sends
 * "what" and "which section" — nothing else — and never throws, never
 * waits, never retries. Browsers that send Global Privacy Control or Do
 * Not Track are not counted at all.
 */
import { sectionOf, type TallyKind } from './counts'

/** Songs already counted as played on this page view (pause/resume is one play). */
const playedThisVisit = new Set<string>()

function optedOut(): boolean {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    return nav.globalPrivacyControl === true || nav.doNotTrack === '1'
  } catch {
    return true
  }
}

export function countEvent(kind: TallyKind): void {
  try {
    if (typeof window === 'undefined' || optedOut()) return
    const body = JSON.stringify({ k: kind, s: sectionOf(window.location.pathname) })
    // /api/tally: a plain name, not one content blockers eat by pattern.
    void fetch('/api/tally', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // Counting must never get in the way of the music.
  }
}

/**
 * A song started. The song's id only dedupes in this tab's memory — it
 * is never sent. Called from every player when a song begins sounding.
 */
export function countPlay(songId: string | null | undefined): void {
  const key = songId || 'unknown'
  if (playedThisVisit.has(key)) return
  playedThisVisit.add(key)
  countEvent('play')
}
