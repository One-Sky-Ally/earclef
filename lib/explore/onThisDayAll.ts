import { canonicalizeTags } from './genreFamilies'
import type { OnThisDayItem } from './onThisDay'

/**
 * EVERY release on a calendar day (owner, Nov 22 2026): the On This Day
 * filters reach past the ~80 releases the page lists to every exact-dated
 * original the day holds (about 2,000 on Nov 22).
 *
 * The day files are written by scripts/build-on-this-day.mjs into
 * public/data/on-this-day/MM-DD.json — static, so they never weigh on the
 * server, and fetched only after the listed day has shown. The unfiltered
 * view never depends on them.
 *
 * Compact on purpose (one artist row shared by all their releases):
 *   artists: [name, country, mbid | null, rawTags[]]
 *   items:   [year, title, kind, artistIndex, discogsReleaseId | 0]
 * A play button still comes ONLY from the verified listed releases: a
 * day-file release that is also listed is replaced by its listed self.
 */

export type DayFileArtist = [name: string, country: string, mbid: string | null, tags: string[]]
export type DayFileItem = [year: number, title: string, kind: string, artist: number, discogs: number]

export interface DayFile {
  date: string
  /** Names for the day's country codes. */
  countryNames?: Record<string, string>
  artists: DayFileArtist[]
  items: DayFileItem[]
}

/** The public path of a day's file. */
export const dayFilePath = (monthDay: string) => `/data/on-this-day/${monthDay}.json`

/** Matches GENRE_LIMIT in onThisDay.ts, so genres read as they do in the list. */
const GENRE_LIMIT = 4

/** The same key the page uses for a release (OnThisDay.tsx itemKey). */
export const releaseKey = (item: Pick<OnThisDayItem, 'a' | 'dg' | 'y' | 't'>) =>
  `${item.a ?? item.dg}-${item.y}-${item.t}`

function isDayFile(value: unknown, monthDay: string): value is DayFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<DayFile>
  return file.date === monthDay && Array.isArray(file.artists) && Array.isArray(file.items)
}

export interface EveryReleaseDay {
  items: OnThisDayItem[]
  countryNames: Record<string, string>
}

/**
 * Every release of the day, as list items, in the file's order (oldest
 * first; within a year the most-followed artist first). Listed releases
 * keep their own entry — with its verified video and place — and any
 * listed release the file lacks is kept too, so filtering never hides
 * something the unfiltered list shows. Null when the file is not a day
 * file for this date.
 */
export function decodeDayFile(
  value: unknown,
  monthDay: string,
  listed: readonly OnThisDayItem[],
): EveryReleaseDay | null {
  if (!isDayFile(value, monthDay)) return null
  const byKey = new Map(listed.map((item) => [releaseKey(item), item]))
  const genres = value.artists.map(([, , , tags]) => canonicalizeTags(tags ?? []).slice(0, GENRE_LIMIT))
  const out: OnThisDayItem[] = []
  const used = new Set<string>()
  for (const [y, t, k, index, dg] of value.items) {
    const artist = value.artists[index]
    if (!artist) continue
    const [n, c, mbid] = artist
    const item: OnThisDayItem = {
      y,
      t,
      k,
      c,
      n,
      genres: genres[index],
      ...(mbid ? { a: mbid } : {}),
      ...(dg ? { dg, gapFill: true } : {}),
    }
    const key = releaseKey(item)
    if (used.has(key)) continue
    used.add(key)
    out.push(byKey.get(key) ?? item)
  }
  const missing = listed.filter((item) => !used.has(releaseKey(item)))
  const countryNames = value.countryNames && typeof value.countryNames === 'object' ? value.countryNames : {}
  if (missing.length === 0) return { items: out, countryNames }
  // Rare: a listed release the file was built without. Keep it, in year order.
  return { items: [...out, ...missing].sort((a, b) => a.y - b.y), countryNames }
}
