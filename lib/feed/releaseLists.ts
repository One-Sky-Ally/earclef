/**
 * The two release lists the Feed opens in pop-ups (owner, Nov 18 2026):
 * "Coming soon" (announced, not out yet) and "Recently released".
 * Pure — the feed's filters run first, these only choose and order.
 */

/**
 * "Recently" means released in the last this-many days, today included:
 * a year (owner, Nov 23 2026; it was 30 days, and too much went by
 * unseen). The pop-up pages through it and filters by the listener's rows.
 */
export const RECENT_DAYS = 365

interface Dated {
  type: 'release' | 'video'
  /** YYYY-MM-DD, sometimes YYYY-MM, sometimes a full timestamp. */
  date: string
}

/** A release dated after today; on release day it is out. */
export function isUpcoming(item: Dated, todayIso: string): boolean {
  return item.type === 'release' && item.date.slice(0, 10) > todayIso
}

/** Announced releases, soonest first. */
export function comingSoon<T extends Dated>(items: T[], todayIso: string): T[] {
  return items
    .filter((item) => isUpcoming(item, todayIso))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Releases out in the last `days` days (today and the `days - 1` before
 * it), newest first. A month-only date ("2026-11") compares as that
 * month's first day.
 */
export function recentlyReleased<T extends Dated>(
  items: T[],
  todayIso: string,
  days: number = RECENT_DAYS,
): T[] {
  const cutoff = new Date(Date.parse(todayIso) - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10)
  return items
    .filter((item) => {
      if (item.type !== 'release') return false
      const day = item.date.slice(0, 10)
      return day <= todayIso && day >= cutoff
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
