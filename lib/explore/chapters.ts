/**
 * Artist Chapters — the presence model's edges, as the panels render
 * them (owner-approved Oct 11, 2026). An artist is ONE origin (the pool
 * entry they already have) plus chapters: other places their music
 * happened, each with the dates a source gives and nothing more.
 *
 *   - `based`: lived and made music there. A chapter dated at its start
 *     places the artist in that country's panel for its years (counted
 *     there too — presences, not persons). Undated, it is a line on the
 *     home row only; it never puts the artist in the second panel.
 *   - `recorded`: a recording session abroad. Always a line, never a
 *     placement, never counted (owner ruling: one-off sessions are not
 *     chapters).
 *
 * Years come straight from the source: an exact year, or a decade
 * reading when the source only gives rough timing ("mid-1980s"). The
 * line reads "Burkina Faso · Paris 1985–2002" or "Burkina Faso · Paris
 * mid-80s – early 2000s". Never "from".
 *
 * Pure and client-safe — the data file behind it is read only by the
 * server (chaptersServer.ts).
 */

export type RoughYear = number | string

export interface Chapter {
  kind: 'based' | 'recorded'
  /** The globe code the chapter lands in (ISO country or claimed place). */
  country: string
  countryName: string
  /** The city when the source names one; the country stands in otherwise. */
  place?: string
  from?: RoughYear | null
  to?: RoughYear | null
  /** Which pass wrote the chapter (keep-note, origin-correction, recording-place, wikidata, musicbrainz-place, owner). */
  source: string
  /** The statement the chapter rests on, quoted. Provenance only. */
  evidence?: string
}

export interface ArtistChapters {
  name: string
  /** The pool country the artist's own entry sits in — their origin. */
  home: string
  homeName: string
  /**
   * The year the artist's own record ends (death, dissolution), when a
   * source has it. An open-ended chapter runs no further than this.
   */
  ended?: number | null
  /** Gap-fill entries carry their verified-play key; MusicBrainz artists are keyed by MBID. */
  playKey?: string
  tags?: string[]
  chapters: Chapter[]
}

const ROUGH = /^(early|mid|late)?-?(\d{3})0s$/

/**
 * The years a value can honestly mean: an exact year is itself; "1930s"
 * is the decade; "early", "mid" and "late" are its thirds, overlapping
 * at the edges because the words do.
 */
export function yearBounds(value: RoughYear): [number, number] {
  if (typeof value === 'number') return [value, value]
  const match = ROUGH.exec(value)
  if (!match) throw new Error(`Not a year or decade reading: ${value}`)
  const decade = Number(match[2]) * 10
  switch (match[1]) {
    case 'early':
      return [decade, decade + 3]
    case 'mid':
      return [decade + 3, decade + 7]
    case 'late':
      return [decade + 6, decade + 9]
    default:
      return [decade, decade + 9]
  }
}

/** "1985", "1930s", "mid-80s", "early 2000s". */
export function yearLabel(value: RoughYear): string {
  if (typeof value === 'number') return String(value)
  const match = ROUGH.exec(value)
  if (!match) throw new Error(`Not a year or decade reading: ${value}`)
  const decade = `${match[2]}0s`
  if (!match[1]) return decade
  // "mid-80s" where the short form is unambiguous (1930s–1990s); "early
  // 2000s", "early 1920s" where the century is the point.
  const short = /^19[3-9]/.test(decade) ? decade.slice(2) : decade
  return match[1] === 'mid' && short.length === 3 ? `mid-${short}` : `${match[1]} ${short}`
}

const isRough = (value: RoughYear | null | undefined) => typeof value === 'string'

/** "1985–2002", "mid-80s – early 2000s", "since 1985", "until 2002", "". */
export function spanLabel(from?: RoughYear | null, to?: RoughYear | null): string {
  if (from != null && to != null) {
    if (from === to) return yearLabel(from)
    const dash = isRough(from) || isRough(to) ? ' – ' : '–'
    return `${yearLabel(from)}${dash}${yearLabel(to)}`
  }
  if (from != null) return `since ${yearLabel(from)}`
  if (to != null) return `until ${yearLabel(to)}`
  return ''
}

function placeWithYears(chapter: Chapter): string {
  const years = spanLabel(chapter.from, chapter.to)
  const place = chapter.place ?? chapter.countryName
  return years ? `${place} ${years}` : place
}

/** The home row's line: "Origin · Place years · Place years". Undefined without a based chapter. */
export function chapterLine(homeName: string, chapters: Chapter[]): string | undefined {
  const based = chapters.filter((chapter) => chapter.kind === 'based')
  if (based.length === 0) return undefined
  return [homeName, ...based.map(placeWithYears)].join(' · ')
}

/** "Recorded in Copenhagen 1984 · Roma 2014". Undefined without a recorded chapter. */
export function recordedLine(chapters: Chapter[]): string | undefined {
  const recorded = chapters.filter((chapter) => chapter.kind === 'recorded')
  if (recorded.length === 0) return undefined
  return `Recorded in ${recorded.map(placeWithYears).join(' · ')}`
}

/**
 * Whether this chapter puts the artist in its country's panel for the
 * span: based, dated at its start, and overlapping. An open end runs on
 * — but never past the artist's own end (`artistEnd`: death or
 * dissolution) when a source has it; a missing start can never be
 * gated, so it stays a line.
 */
export function placesArtistIn(
  chapter: Chapter,
  yearStart: number,
  yearEnd: number,
  artistEnd?: number | null,
): boolean {
  if (chapter.kind !== 'based' || chapter.from == null) return false
  const start = yearBounds(chapter.from)[0]
  const end = chapter.to != null ? yearBounds(chapter.to)[1] : (artistEnd ?? Infinity)
  return start <= yearEnd && end >= yearStart
}

/** The countries whose panels a dated based chapter can reach, once each. */
export function chapterPlaces(chapters: Chapter[]): string[] {
  const places = new Set<string>()
  for (const chapter of chapters) {
    if (chapter.kind === 'based' && chapter.from != null) places.add(chapter.country)
  }
  return [...places]
}
