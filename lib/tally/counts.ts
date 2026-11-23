/**
 * Anonymous visitor counts (owner, Nov 22 2026: "add anonymous counting
 * of plays, saves and shares, so I can see what visitors actually do on
 * the site. No tracking of who people are").
 *
 * A count is two words and nothing else: WHAT happened (play, save,
 * share) and WHERE on the site (a section, never a full address). The
 * server adds it to that day's totals. No id, cookie, IP address,
 * browser detail, song or artist travels with it, and nothing links one
 * count to another — so the totals cannot be turned back into people.
 * The privacy page says exactly this; change one, check the other.
 *
 * Pure: shared by the browser beacon, the route and the Studio panel.
 */

export const TALLY_KINDS = ['play', 'save', 'share'] as const
export type TallyKind = (typeof TALLY_KINDS)[number]

export const TALLY_SECTIONS = [
  'home',
  'feed',
  'explore',
  'on-this-day',
  'artist',
  'archive-artist',
  'cultures',
  'artists',
  'taste-map',
  'me',
  'other',
] as const
export type TallySection = (typeof TALLY_SECTIONS)[number]

/** Plain-language names for the Studio panel. */
export const SECTION_LABELS: Record<TallySection, string> = {
  home: 'Home page',
  feed: 'Feed',
  explore: 'Explore',
  'on-this-day': 'On This Day',
  artist: 'Artist pages',
  'archive-artist': 'Archive artist pages',
  cultures: 'Cultures',
  artists: 'Artists list',
  'taste-map': 'Shared taste maps',
  me: 'My page',
  other: 'Other pages',
}

/** Top-level pages that are NOT artist slugs (app/[slug] catches the rest). */
const OTHER_PAGES = new Set([
  'for-artists',
  'get-on-the-map',
  'manifesto',
  'privacy',
  'terms',
  'suggest',
  'studio',
])

/** The section of the site a path belongs to — the only "where" a count carries. */
export function sectionOf(pathname: string): TallySection {
  const parts = pathname.split(/[?#]/)[0].split('/').filter(Boolean)
  if (parts.length === 0) return 'home'
  const [first] = parts
  if (first === 'feed') return 'feed'
  if (first === 'explore') return 'explore'
  if (first === 'on-this-day') return 'on-this-day'
  if (first === 'cultures') return 'cultures'
  if (first === 'artists') return 'artists'
  if (first === 'me') return 'me'
  if (first === 'fan') return 'taste-map'
  if (first === 'a') return 'archive-artist'
  if (OTHER_PAGES.has(first) || parts.length > 1) return 'other'
  return 'artist'
}

export function isTallyKind(value: unknown): value is TallyKind {
  return typeof value === 'string' && (TALLY_KINDS as readonly string[]).includes(value)
}

export function isTallySection(value: unknown): value is TallySection {
  return (
    typeof value === 'string' && (TALLY_SECTIONS as readonly string[]).includes(value)
  )
}

/** One day's totals: "play:feed" → 12. */
export type DayTotals = Record<string, number>

export const tallyKey = (kind: TallyKind, section: TallySection) => `${kind}:${section}`

/** The day's totals with one more of this kind, in this section. */
export function addOne(day: DayTotals, kind: TallyKind, section: TallySection): DayTotals {
  const key = tallyKey(kind, section)
  return { ...day, [key]: (day[key] ?? 0) + 1 }
}

/** "2026-11-22" — days run on UTC, the same for every visitor. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The last `count` day keys, newest first. */
export function recentDays(today: Date, count: number): string[] {
  const days: string[] = []
  for (let i = 0; i < count; i++) {
    days.push(dayKey(new Date(today.getTime() - i * 24 * 60 * 60 * 1000)))
  }
  return days
}

export interface TallyTable {
  /** Section → kind → total. Only sections with at least one count. */
  rows: { section: TallySection; counts: Record<TallyKind, number> }[]
  totals: Record<TallyKind, number>
}

const zero = (): Record<TallyKind, number> => ({ play: 0, save: 0, share: 0 })

/** Sums several days into one table, busiest section first. */
export function sumDays(days: DayTotals[]): TallyTable {
  const bySection = new Map<TallySection, Record<TallyKind, number>>()
  const totals = zero()
  for (const day of days) {
    for (const [key, value] of Object.entries(day)) {
      const [kind, section] = key.split(':')
      if (!isTallyKind(kind) || !isTallySection(section)) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
      const counts = bySection.get(section) ?? zero()
      counts[kind] += value
      totals[kind] += value
      bySection.set(section, counts)
    }
  }
  const rows = [...bySection.entries()]
    .map(([section, counts]) => ({ section, counts }))
    .sort(
      (a, b) =>
        b.counts.play + b.counts.save + b.counts.share -
          (a.counts.play + a.counts.save + a.counts.share) ||
        TALLY_SECTIONS.indexOf(a.section) - TALLY_SECTIONS.indexOf(b.section),
    )
  return { rows, totals }
}
