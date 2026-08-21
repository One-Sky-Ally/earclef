import usFile from './number-ones-us.json'
import ukFile from './number-ones-uk.json'
import playFile from './hits-play.json'

/**
 * #1 hits serving — SERVER-ONLY (imported by /api/hits, never by a
 * client component; the datasets stay out of the browser bundle per
 * the Aug 2026 bandwidth lesson).
 *
 * Gate v3 Tier 1 sourcing: a country appears here ONLY with an
 * authoritative chart (Billboard Hot 100, OCC Official Singles Chart),
 * era-bounded to the chart's real history. No chart = null = no
 * section, ever. Play links join at response time from the
 * owner-approved verification sweep (hits-play.json) — a hit without a
 * verified video renders without a ▶, never with a search URL.
 */

interface StoredHit {
  title: string
  artist: string
  /** First week at #1 within the year (US) / reign start (UK). */
  first: string
  weeks: number
}

interface ChartFile {
  chart: string
  chartName: string
  attribution: string
  generatedAt: string
  years: Record<string, { entries: StoredHit[]; sourcePage: string }>
}

interface PlayEntry {
  videoId: string
}

const CHARTS: Record<string, ChartFile> = {
  US: usFile as unknown as ChartFile,
  GB: ukFile as unknown as ChartFile,
}

const PLAY = playFile as unknown as Record<string, PlayEntry>

/** Top 5 + five "show 20 more" reveals — spans never ship unbounded. */
const ENTRY_CAP = 105

export interface HitEntry extends StoredHit {
  videoId: string | null
}

export interface HitsPayload {
  chart: string
  chartName: string
  attribution: string
  total: number
  capped: boolean
  entries: HitEntry[]
}

/** Deterministic join key for the verification sweep's output. */
export function hitPlayKey(chart: string, artist: string, title: string): string {
  return `${chart}|${artist}|${title}`
}

/**
 * The #1 hits of a place across an inclusive year span, ranked by
 * weeks at #1 (ties chronological). Returns null when the place or
 * every year of the span lies outside the authoritative chart's
 * history — absence of a source renders NOTHING, never an inference.
 */
export function hitsFor(
  country: string,
  start: number,
  end: number,
): HitsPayload | null {
  const chart = CHARTS[country]
  if (!chart) return null

  // Merge the span; a reign spanning Dec 31 appears in both US year
  // files, so identical title+artist entries fold into one with their
  // weeks summed and the earliest first-week kept.
  const merged = new Map<string, HitEntry>()
  let anyYearCovered = false
  for (let year = start; year <= end; year++) {
    const stored = chart.years[String(year)]
    if (!stored) continue
    anyYearCovered = true
    for (const entry of stored.entries) {
      const key = hitPlayKey(chart.chart, entry.artist, entry.title)
      const existing = merged.get(key)
      if (existing) {
        merged.set(key, {
          ...existing,
          weeks: existing.weeks + entry.weeks,
          first: existing.first < entry.first ? existing.first : entry.first,
        })
      } else {
        merged.set(key, {
          ...entry,
          videoId: PLAY[key]?.videoId ?? null,
        })
      }
    }
  }
  if (!anyYearCovered) return null

  const ranked = [...merged.values()].sort(
    (a, b) => b.weeks - a.weeks || a.first.localeCompare(b.first),
  )
  return {
    chart: chart.chart,
    chartName: chart.chartName,
    attribution: chart.attribution,
    total: ranked.length,
    capped: ranked.length > ENTRY_CAP,
    entries: ranked.slice(0, ENTRY_CAP),
  }
}
