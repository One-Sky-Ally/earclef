/**
 * "On this day" selection rules (owner, Oct 10 2026): music released on
 * a calendar day in past years, from any country — ONLY exact release
 * dates. Pure functions, so the rules are testable apart from the dumps.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
/** No release this site carries predates recorded sound's commercial era. */
const EARLIEST_YEAR = 1888

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * { year, monthDay } for an EXACT, real date on or before `today`
 * (YYYY-MM-DD); null for a year- or month-only date, an impossible date,
 * the future, or Jan 1 — the day catalogues fill in when only the year
 * is known, so it is never trusted as exact.
 */
export function exactDay(value, today) {
  const match = DATE.exec(String(value ?? '').trim())
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < EARLIEST_YEAR || month < 1 || month > 12 || day < 1) return null
  const lastDay = month === 2 && !isLeap(year) ? 28 : DAYS_IN_MONTH[month - 1]
  if (day > lastDay) return null
  if (month === 1 && day === 1) return null
  if (`${yearText}-${monthText}-${dayText}` > today) return null
  return { year, monthDay: `${monthText}-${dayText}` }
}

/** An original release: album, single or EP, with no secondary type (compilation, live, remix…). */
export function isOriginalMbGroup(row) {
  return ['Album', 'Single', 'EP'].includes(row.p) && (row.s ?? []).length === 0
}

/** The title key the era-dating corrections are stored under (same as the queue route). */
export const titleKey = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * True when the era-dating corrections say this group's music is from a
 * different year than its MusicBrainz date — the exact date is then a
 * reissue's, not the release this page would claim.
 */
export function correctedAway(row, year, dating) {
  if (!dating) return false
  const span = dating.a?.[row.i]
  if (span && (year < span[0] || year > span[1])) return true
  const songYear = dating.s?.[titleKey(row.t)]
  return songYear !== undefined && songYear !== year
}

const decadeOf = (year) => String(Math.floor(year / 10) * 10)
const tally = (items, keyOf) => {
  const counts = {}
  for (const entry of items) counts[keyOf(entry)] = (counts[keyOf(entry)] ?? 0) + 1
  return counts
}

/**
 * One day's page: totals for honesty, and a selection that a page can
 * show. Recent decades hold almost every exact date, so each decade gets
 * the same quota (perDecade). Inside a decade the quota is dealt
 * ROUND-ROBIN across countries — each country's best (by artist weight)
 * in turn, countries ordered by their best — so one place cannot fill
 * it while others wait. Before 2000,
 * gap-fill entries (the archive's sparse places, rare on the old record)
 * are always kept on top of the quota; after 2000 they take turns like
 * everyone. Items come back oldest first.
 */
const RARE_BEFORE = 2000

function roundRobin(entries, quota) {
  const byCountry = new Map()
  for (const entry of entries) {
    if (!byCountry.has(entry.c)) byCountry.set(entry.c, [])
    byCountry.get(entry.c).push(entry)
  }
  const queues = [...byCountry.values()]
    .map((list) => list.sort((a, b) => b.w - a.w || a.y - b.y || a.t.localeCompare(b.t)))
    .sort((a, b) => b[0].w - a[0].w || a[0].c.localeCompare(b[0].c))
  // One per country per round, until the decade's slots are full: every
  // country gets a turn before any gets a second, and a decade with room
  // shows everything it holds.
  const picked = []
  for (let round = 0; picked.length < quota; round++) {
    const waiting = queues.filter((queue) => queue[round])
    if (waiting.length === 0) break
    for (const queue of waiting.slice(0, quota - picked.length)) picked.push(queue[round])
  }
  return picked
}

export function selectDay(items, { perDecade }) {
  if (items.length === 0) return { total: 0, byDecade: {}, byCountry: {}, items: [] }
  const byDecade = new Map()
  for (const entry of items) {
    const key = decadeOf(entry.y)
    if (!byDecade.has(key)) byDecade.set(key, [])
    byDecade.get(key).push(entry)
  }
  const chosen = []
  for (const [decade, group] of byDecade) {
    const rare = Number(decade) < RARE_BEFORE
    const keptRare = rare ? group.filter((entry) => entry.gapFill) : []
    const contenders = rare ? group.filter((entry) => !entry.gapFill) : group
    chosen.push(...keptRare, ...roundRobin(contenders, perDecade))
  }
  chosen.sort((a, b) => a.y - b.y || b.w - a.w || a.t.localeCompare(b.t))
  return {
    total: items.length,
    byDecade: tally(items, (entry) => decadeOf(entry.y)),
    byCountry: tally(items, (entry) => entry.c),
    items: chosen,
  }
}
