import onThisDayIndex from './on-this-day/index.json'
import { canonicalizeTags } from './genreFamilies'

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
  /**
   * A VERIFIED, playable video of this release (scripts/verify-on-this-
   * day-play.mjs): id-anchored to the artist, the same release, and
   * playability-checked. Absent = no play button, not in the playlist.
   */
  v?: string
  /** The video's YouTube title. */
  vt?: string
  /** The song the video is: the matched track, or the release itself. */
  vs?: string
  /** The artist's genres, canonicalized exactly as the Explore panels do. */
  genres: string[]
  /** MusicBrainz release group (the recording-place key). */
  rg?: string
  /**
   * Where this song was MADE — recorded — when MusicBrainz says so by id
   * (scripts/build-on-this-day-places.mjs). Never a birthplace, never a
   * country of issue. City when known, else the country alone.
   */
  place?: SongPlace
}

export interface SongPlace {
  /** "Recorded in Sydney, Australia" / "Recorded in Australia". */
  label: string
  /** The place on the globe, in the song's year. */
  href: string
}

/** What the shards store: raw tags, canonicalized on the way out. */
type StoredItem = Omit<OnThisDayItem, 'genres'> & { g?: string[] }

export interface OnThisDayDay {
  /** Every exact-dated original on this calendar day. */
  total: number
  byDecade: Record<string, number>
  byCountry: Record<string, number>
  /** The decade-balanced selection, oldest first. */
  items: OnThisDayItem[]
}

interface StoredDay extends Omit<OnThisDayDay, 'items'> {
  items: StoredItem[]
}

interface MonthShard {
  month: string
  days: Record<string, StoredDay>
}

/** Matches POOL_TAG_LIMIT in countryData.ts, so genres read as they do on a panel. */
const GENRE_LIMIT = 4

interface StoredPlace {
  city: string | null
  country: string
  countryName: string
  /** The globe's own US-state / UK-nation code, when the place is in one. */
  sub?: string
}

interface PlacesFile {
  groups: Record<string, { release?: StoredPlace; tracks?: Record<string, StoredPlace> }>
}

let placesFile: PlacesFile | null | undefined

async function loadPlaces(): Promise<PlacesFile | null> {
  if (placesFile !== undefined) return placesFile
  try {
    const loaded = await import('./on-this-day/places.json')
    placesFile = (loaded.default ?? loaded) as PlacesFile
  } catch {
    // No places file is no opinion: songs simply show no place.
    placesFile = null
  }
  return placesFile
}

/** The key recordings are stored under (scripts/lib/onThisDayPlace.mjs songKey). */
const songKey = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The song's own recording first, the whole release only when the song has none. */
function placeFor(item: StoredItem, places: PlacesFile | null): SongPlace | undefined {
  if (!item.v || !item.rg || !places) return undefined
  const group = places.groups[item.rg]
  const stored = group?.tracks?.[songKey(item.vs ?? item.t)] ?? group?.release
  if (!stored) return undefined
  const countryName = index.countryNames[stored.country] ?? stored.countryName
  return {
    label: stored.city ? `Recorded in ${stored.city}, ${countryName}` : `Recorded in ${countryName}`,
    href: `/?y=${item.y}&c=${stored.sub ?? stored.country}`,
  }
}

function servedItem({ g, ...item }: StoredItem, places: PlacesFile | null): OnThisDayItem {
  const place = placeFor(item, places)
  return {
    ...item,
    genres: canonicalizeTags(g ?? []).slice(0, GENRE_LIMIT),
    ...(place ? { place } : {}),
  }
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
  const [shard, places] = await Promise.all([loadMonth(date.slice(0, 2)), loadPlaces()])
  const stored = shard?.days[date]
  const day: OnThisDayDay = stored
    ? { ...stored, items: stored.items.map((item) => servedItem(item, places)) }
    : EMPTY_DAY
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
