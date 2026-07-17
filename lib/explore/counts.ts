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

// Ember → deep gold → brand gold → white-gold, all within the site palette.
const HEAT_STOPS: { t: number; rgb: [number, number, number]; a: number }[] = [
  { t: 0, rgb: [96, 52, 18], a: 0.22 },
  { t: 0.4, rgb: [201, 127, 26], a: 0.55 },
  { t: 0.72, rgb: [242, 169, 59], a: 0.8 },
  { t: 1, rgb: [255, 236, 200], a: 0.95 },
]

const ZERO_HEAT_COLOR = 'rgba(242, 169, 59, 0.05)'

/** Map 0..1 heat to a palette color; `hovered` brightens toward white. */
export function heatColor(t: number, hovered = false): string {
  if (t <= 0) {
    return hovered ? 'rgba(242, 169, 59, 0.28)' : ZERO_HEAT_COLOR
  }
  const clamped = Math.min(t, 1)
  let lower = HEAT_STOPS[0]
  let upper = HEAT_STOPS[HEAT_STOPS.length - 1]
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    if (clamped >= HEAT_STOPS[i].t && clamped <= HEAT_STOPS[i + 1].t) {
      lower = HEAT_STOPS[i]
      upper = HEAT_STOPS[i + 1]
      break
    }
  }
  const span = upper.t - lower.t || 1
  const mix = (clamped - lower.t) / span
  const lerp = (a: number, b: number) => a + (b - a) * mix
  let [r, g, b] = [
    lerp(lower.rgb[0], upper.rgb[0]),
    lerp(lower.rgb[1], upper.rgb[1]),
    lerp(lower.rgb[2], upper.rgb[2]),
  ]
  let alpha = lerp(lower.a, upper.a)

  if (hovered) {
    r += (255 - r) * 0.25
    g += (255 - g) * 0.25
    b += (255 - b) * 0.25
    alpha = Math.min(alpha + 0.15, 1)
  }
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`
}

/** Total releases for one country across an inclusive year span. */
export function countInRange(
  byYear: Record<string, number> | undefined,
  start: number,
  end: number,
): number {
  if (!byYear) return 0
  let total = 0
  for (let year = start; year <= end; year++) {
    total += byYear[year] ?? 0
  }
  return total
}

/** The hottest country's total across the span — the heat ceiling. */
export function maxForRange(
  counts: CountryYearCounts,
  start: number,
  end: number,
): number {
  let max = 0
  for (const byYear of Object.values(counts)) {
    const value = countInRange(byYear, start, end)
    if (value > max) max = value
  }
  return max
}
