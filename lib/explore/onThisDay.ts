import onThisDayIndex from './on-this-day/index.json'

/**
 * "On this day" (owner, Oct 10 2026): music released on a calendar day in
 * past years, from any country with an exact release date. Built by
 * scripts/build-on-this-day.mjs from the local MusicBrainz and Discogs
 * dumps — ONLY exact dates (never year- or month-only, never Jan 1).
 *
 * Twelve month shards, loaded on demand with a template-literal import
 * (the pattern countryData.ts uses, so the bundler traces every shard).
 * Server-only: the client asks /api/on-this-day/[date].
 */

export interface OnThisDayItem {
  /** Year of the original release. */
  y: number
  /** Release title. */
  t: string
  /** Album | Single | EP (MusicBrainz) or a Discogs format word. */
  k: string
  /** The artist's country on the site. */
  c: string
  /** Artist name. */
  n: string
  /** MusicBrainz artist id (the archive card), when from MusicBrainz. */
  a?: string
  /** Discogs release id, when from a gap-fill artist's Discogs original. */
  dg?: number
  gapFill?: boolean
}

export interface OnThisDayDay {
  /** Every exact-dated original on this calendar day. */
  total: number
  byDecade: Record<string, number>
  byCountry: Record<string, number>
  /** The decade-balanced selection, oldest first. */
  items: OnThisDayItem[]
}

interface MonthShard {
  month: string
  days: Record<string, OnThisDayDay>
}

interface OnThisDayIndex {
  datedThrough: string
  perDecade: number
  countryNames: Record<string, string>
}

const index = onThisDayIndex as OnThisDayIndex

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** 'MM-DD' for a real calendar day (02-29 included), else null. */
export function parseMonthDay(value: string): string | null {
  const match = /^(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null
  return value
}

const cache = new Map<string, MonthShard | null>()

async function loadMonth(month: string): Promise<MonthShard | null> {
  const held = cache.get(month)
  if (held !== undefined) return held
  let shard: MonthShard | null = null
  try {
    const loaded = await import(`./on-this-day/${month}.json`)
    shard = (loaded.default ?? loaded) as MonthShard
  } catch {
    shard = null
  }
  cache.set(month, shard)
  return shard
}

const EMPTY_DAY: OnThisDayDay = { total: 0, byDecade: {}, byCountry: {}, items: [] }

export interface OnThisDayPayload extends OnThisDayDay {
  date: string
  datedThrough: string
  perDecade: number
  /** Names for every country code in this payload. */
  countryNames: Record<string, string>
}

/** A day's payload, or null when the date is not a calendar day. */
export async function onThisDay(monthDay: string): Promise<OnThisDayPayload | null> {
  const date = parseMonthDay(monthDay)
  if (!date) return null
  const shard = await loadMonth(date.slice(0, 2))
  const day = shard?.days[date] ?? EMPTY_DAY
  const codes = new Set([...Object.keys(day.byCountry), ...day.items.map((item) => item.c)])
  return {
    ...day,
    date,
    datedThrough: index.datedThrough,
    perDecade: index.perDecade,
    countryNames: Object.fromEntries(
      [...codes].map((code) => [code, index.countryNames[code] ?? code]),
    ),
  }
}
