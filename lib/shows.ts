import type { PastShow, ShowsContent, UpcomingShow } from './types'

export interface SplitShows {
  /** Dated today or later, soonest first. */
  upcoming: UpcomingShow[]
  /** Everything already played, newest first — including dates that were
   *  filed as upcoming and have since gone by. */
  past: PastShow[]
  /**
   * Whether the page's written upcoming note still holds. A note written
   * to sit beside announced dates ("European dates below") stops being
   * true once every one of those dates has passed, so it is not shown.
   */
  noteStillHolds: boolean
}

/** Today as YYYY-MM-DD in the listener's own calendar. */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Sorts the shows on record into Upcoming and Past by date. Nothing is
 * invented: a show only moves from one list to the other when its date
 * has gone by. Duplicate entries (same date and venue) are kept once.
 */
export function splitShows(shows: ShowsContent, today: string): SplitShows {
  const filedUpcoming = shows.upcoming ?? []
  const upcoming = filedUpcoming
    .filter((show) => show.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  const lapsed: PastShow[] = filedUpcoming
    .filter((show) => show.date < today)
    .map(({ date, venue, city, note }) => ({ date, venue, city, note }))

  const seen = new Set<string>()
  const past = [...(shows.past ?? []), ...lapsed]
    .filter((show) => {
      const key = `${show.date}|${show.venue}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  return {
    upcoming,
    past,
    noteStillHolds: filedUpcoming.length === 0 || upcoming.length > 0,
  }
}
