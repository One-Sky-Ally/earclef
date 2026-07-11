import type { CountryYearCounts } from '@/lib/explore/counts'

/**
 * Deterministic simulated dataset used until the real MusicBrainz
 * precompute lands in public/data/. Shaped to look plausible: output
 * grows over the century, big recording markets run hotter, and every
 * (country, year) pair jitters stably so the globe feels alive.
 */
const MARKET_WEIGHT: Record<string, number> = {
  US: 10, GB: 6.5, JP: 5, DE: 4.2, FR: 3.6, CA: 2.6, AU: 2.2, IT: 2.2,
  NL: 2, SE: 1.9, BR: 1.8, ES: 1.6, MX: 1.4, RU: 1.4, FI: 1.3, NO: 1.2,
}

function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export function generateMockCounts(
  codes: string[],
  yearMin: number,
  yearMax: number,
): CountryYearCounts {
  const counts: CountryYearCounts = {}

  for (const code of codes) {
    const size = MARKET_WEIGHT[code] ?? 0.15 + hash(code) * 1.2
    const byYear: Record<string, number> = {}

    for (let year = yearMin; year <= yearMax; year++) {
      const t = (year - 1900) / (2026 - 1900)
      const growth = Math.pow(t, 2.4) * 3200
      const jitter = 0.55 + hash(`${code}:${year}`) * 0.9
      const emerges = hash(code) * 0.35 // smaller scenes appear later
      const value = t < emerges ? 0 : Math.round(size * growth * jitter)
      byYear[year] = value
    }
    counts[code] = byYear
  }
  return counts
}
