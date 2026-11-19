/**
 * The era ranking: every title this artist put out, ordered by how
 * era-true it is — in-era first (singles beat EPs beat albums beat
 * single recordings, closest to mid-decade), then work within ±15 years
 * by proximity, then undated catalog. Track 1 takes the head of this
 * list; the deeper entries are what let one artist contribute more
 * than one song, each carrying the era it actually earned.
 *
 * Moved from the queue route on Nov 19 2026, unchanged in behaviour for
 * release groups. Recording titles (songs) now join the same list, since
 * a song title is as much the artist's own work as a record title (owner,
 * Nov 19 2026: confirm with any of the artist's song titles).
 *
 * ERA-DATING CORRECTIONS (owner-approved Stage 4, Sep 1 2026 — "music
 * belongs to when it was created"):
 *
 * A title with a per-song correction ranks by its TRUE year — the
 * original recording — instead of MusicBrainz's first-release-date,
 * which for pre-digital catalogs is routinely a CD-era reissue (the
 * Uruguay-1996 bug: a 1964 tango ranked "nearby" for the 1990s off a
 * 2001 compilation date). A retrospective album with no per-song date
 * for a title ranks by the album's SPAN — a range, because a
 * compilation of 1950s-60s sides has no single true year.
 *
 * MOVE, DON'T COPY (owner ruling): a CORRECTED title outside the
 * in-era/nearby bands is DROPPED, not demoted to catalog — once a
 * record is known to be from 1964 it must no longer be reachable from
 * 1996. UNCORRECTED titles keep catalog-tier service untouched, so no
 * artist loses their last playable record to a correction; only the
 * false padding leaves.
 *
 * Live albums and re-recordings never appear in the corrections
 * dataset (excluded upstream by the arbitration rules), so their
 * MusicBrainz dates stand here without this function needing to know
 * why — absence is the verdict.
 *
 * Relative imports only: bundled into Netlify functions.
 */
import type { ArtistDating } from '../../explore/rgDating'
import type { TrackEraRating } from './types'

/** Titles kept for matching — release groups plus up to 100 recordings. */
export const MAX_TITLES = 150

export interface DatedTitle {
  id?: string
  title?: string
  'first-release-date'?: string
  /** 'Single' | 'EP' | 'Album' | … ; 'Recording' for a song title. */
  'primary-type'?: string
}

export interface EraTitle {
  title: string
  era: TrackEraRating
}

const typeRank = (type: string) =>
  type === 'Single' ? 0 : type === 'EP' ? 1 : type === 'Album' ? 2 : 3

interface Ranged {
  title: string
  lo: number
  hi: number
  type: string
  corrected: boolean
}

/** Distance from mid-decade to the nearest edge of a year range. */
function distanceFrom(mid: number, lo: number, hi: number): number {
  return lo > mid ? lo - mid : hi < mid ? mid - hi : 0
}

/** The era a single year earns for a decade — the same bands as below. */
export function eraOfYear(year: number | null | undefined, decade: number): TrackEraRating {
  if (!year || !Number.isFinite(year)) return 'catalog'
  if (year >= decade && year <= decade + 9) return 'in-era'
  return distanceFrom(decade + 5, year, year) <= 15 ? 'nearby' : 'catalog'
}

function dateRange(
  title: DatedTitle,
  dating: ArtistDating | null,
  titleKey: (value: string) => string,
): Ranged | null {
  const name = title.title ?? ''
  const type = title['primary-type'] ?? ''
  const songYear = dating?.s[titleKey(name)]
  if (songYear !== undefined) return { title: name, lo: songYear, hi: songYear, type, corrected: true }
  const span = title.id ? dating?.a[title.id] : undefined
  if (span !== undefined) return { title: name, lo: span[0], hi: span[1], type, corrected: true }
  const mbYear = Number(title['first-release-date']?.slice(0, 4))
  if (Number.isFinite(mbYear) && mbYear > 0) return { title: name, lo: mbYear, hi: mbYear, type, corrected: false }
  return null
}

export function rankEraTitles(
  titles: DatedTitle[],
  decade: number,
  dating: ArtistDating | null,
  titleKey: (value: string) => string,
  limit: number = MAX_TITLES,
): EraTitle[] {
  const mid = decade + 5
  const dated: Ranged[] = []
  const undated: string[] = []
  for (const title of titles) {
    if (!title.title) continue
    const range = dateRange(title, dating, titleKey)
    if (range) dated.push(range)
    else undated.push(title.title)
  }
  const distance = (g: Ranged) => distanceFrom(mid, g.lo, g.hi)
  const isInEra = (g: Ranged) => g.lo <= decade + 9 && g.hi >= decade
  const inEra = dated
    .filter(isInEra)
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || distance(a) - distance(b))
  const nearby = dated
    .filter((g) => !isInEra(g) && distance(g) <= 15)
    .sort((a, b) => distance(a) - distance(b))
  const catalog = dated
    .filter((g) => distance(g) > 15 && !g.corrected)
    .sort((a, b) => distance(a) - distance(b))
  const ranked: EraTitle[] = [
    ...inEra.map((g) => ({ title: g.title, era: 'in-era' as const })),
    ...nearby.map((g) => ({ title: g.title, era: 'nearby' as const })),
    ...catalog.map((g) => ({ title: g.title, era: 'catalog' as const })),
    ...undated.map((title) => ({ title, era: 'catalog' as const })),
  ]
  // Same title can appear as single AND album AND recording — keep the
  // era-truest.
  const seen = new Set<string>()
  return ranked
    .filter((entry) => {
      const key = titleKey(entry.title)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}
