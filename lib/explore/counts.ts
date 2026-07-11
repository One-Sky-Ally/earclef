import { generateMockCounts } from '@/lib/explore/mockCounts'

export interface CountryYearCounts {
  [iso2: string]: Record<string, number>
}

export type DataSource = 'live' | 'simulated'

export const YEAR_MIN = 1900
export const YEAR_MAX = 2026
export const DEFAULT_YEAR = 1969

/**
 * Prefer the precomputed MusicBrainz dataset (public/data/…json, committed
 * once the overnight script finishes); fall back to the simulated set so
 * the globe always works. Callers surface which source is active.
 */
export async function loadCounts(
  codes: string[],
): Promise<{ counts: CountryYearCounts; source: DataSource }> {
  try {
    const res = await fetch('/data/country-year-counts.json')
    if (res.ok) {
      const counts = (await res.json()) as CountryYearCounts
      if (Object.keys(counts).length > 100) return { counts, source: 'live' }
    }
  } catch {
    // fall through to simulated data
  }
  return {
    counts: generateMockCounts(codes, YEAR_MIN, YEAR_MAX),
    source: 'simulated',
  }
}

/** Log-scaled 0..1 heat for a count against the year's hottest country. */
export function heatValue(count: number, yearMax: number): number {
  if (count <= 0 || yearMax <= 0) return 0
  return Math.log1p(count) / Math.log1p(yearMax)
}

export function maxForYear(counts: CountryYearCounts, year: number): number {
  let max = 0
  for (const byYear of Object.values(counts)) {
    const value = byYear[year] ?? 0
    if (value > max) max = value
  }
  return max
}
