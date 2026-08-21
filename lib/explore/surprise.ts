import {
  loadCounts,
  loadNationCounts,
  loadStateCounts,
  type CountryYearCounts,
} from './counts'
import { isoOf, type CountryFeature } from './geo'
import { SUBDIVIDED_REGIONS } from './states'

/**
 * "Surprise me" — one tap, one place+year worth landing on. Selection
 * is a weighted mixture over committed data only (zero-wallet, no AI,
 * no new APIs):
 *
 *   30%  documented eras — combos with a "What was playing" story
 *   40%  substantial country+year — country uniform (variety), year
 *        weighted by that country's release counts (lands in its
 *        loudest eras)
 *   20%  states — state uniform, year weighted by artist emergence
 *   10%  sparse wildcard — obscure-but-real combos (3–24 releases)
 *
 * A branch that can't produce a fresh pick falls through to the next
 * roll; repeats are avoided per session via the caller's seen-set.
 */

export interface SurpriseEra {
  country: string
  from: number
  to: number
}

export interface SurpriseTarget {
  code: string
  name: string
  year: number
}

interface SurpriseData {
  countryCounts: CountryYearCounts
  stateCounts: CountryYearCounts
  countryNames: Map<string, string>
}

const SUBSTANTIAL_RELEASES = 25
const SPARSE_MIN = 3
const MAX_TRIES = 25

/**
 * Everything the picker needs, loaded once on first tap. Every URL here
 * is already fetched by the globe, so warm visitors pay HTTP-cache
 * prices; the button works even when the globe rendered its fallback.
 */
let dataPromise: Promise<SurpriseData> | null = null

export function loadSurpriseData(): Promise<SurpriseData> {
  if (dataPromise) return dataPromise
  dataPromise = (async () => {
    const [countryCounts, stateCounts, nationCounts, countryNames] =
      await Promise.all([
        loadCounts([]).then((result) => result.counts),
        loadStateCounts(),
        loadNationCounts(),
        fetch('/data/countries-110m.geojson')
          .then((res) => (res.ok ? res.json() : { features: [] }))
          .then((geo: { features: CountryFeature[] }) => {
            const names = new Map<string, string>()
            for (const feature of geo.features) {
              const code = isoOf(feature)
              if (code) names.set(code, feature.properties.ADMIN)
            }
            return names
          })
          .catch(() => new Map<string, string>()),
      ])
    // One region map — US state and UK nation codes never collide.
    return {
      countryCounts,
      stateCounts: { ...stateCounts, ...nationCounts },
      countryNames,
    }
  })()
  dataPromise.catch(() => {
    // Let a transient failure retry on the next tap.
    dataPromise = null
  })
  return dataPromise
}

const randomInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1))

/** Weighted pick over a year histogram; null when nothing qualifies. */
function weightedYear(
  byYear: Record<string, number> | undefined,
  minCount: number,
): number | null {
  if (!byYear) return null
  const entries = Object.entries(byYear).filter(
    ([, count]) => count >= minCount,
  )
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  if (total <= 0) return null
  let roll = Math.random() * total
  for (const [year, count] of entries) {
    roll -= count
    if (roll <= 0) return Number(year)
  }
  return Number(entries[entries.length - 1][0])
}

function documentedPick(
  eras: SurpriseEra[],
  names: Map<string, string>,
): SurpriseTarget | null {
  if (eras.length === 0) return null
  const era = eras[randomInt(0, eras.length - 1)]
  return {
    code: era.country,
    name: names.get(era.country) ?? era.country,
    year: randomInt(era.from, era.to),
  }
}

function countryPick(
  counts: CountryYearCounts,
  names: Map<string, string>,
  minReleases: number,
): SurpriseTarget | null {
  const qualifying = Object.keys(counts).filter((code) =>
    Object.values(counts[code]).some((count) => count >= minReleases),
  )
  if (qualifying.length === 0) return null
  const code = qualifying[randomInt(0, qualifying.length - 1)]
  const year = weightedYear(counts[code], minReleases)
  if (year === null) return null
  return { code, name: names.get(code) ?? code, year }
}

function statePick(stateCounts: CountryYearCounts): SurpriseTarget | null {
  if (Object.keys(stateCounts).length === 0) return null
  // A surprise landing can be any subdivided region — a US state or a
  // UK nation. A region absent from the loaded counts (dataset not yet
  // landed) simply yields null and the caller re-rolls.
  const region = SUBDIVIDED_REGIONS[randomInt(0, SUBDIVIDED_REGIONS.length - 1)]
  const year = weightedYear(stateCounts[region.code], 1)
  if (year === null) return null
  return { code: region.code, name: region.name, year }
}

/** Obscure-but-real: a uniform draw over the world's quiet corners. */
function sparsePick(
  counts: CountryYearCounts,
  names: Map<string, string>,
): SurpriseTarget | null {
  const combos: { code: string; year: number }[] = []
  for (const [code, byYear] of Object.entries(counts)) {
    for (const [year, count] of Object.entries(byYear)) {
      if (count >= SPARSE_MIN && count < SUBSTANTIAL_RELEASES) {
        combos.push({ code, year: Number(year) })
      }
    }
  }
  if (combos.length === 0) return null
  const combo = combos[randomInt(0, combos.length - 1)]
  return {
    code: combo.code,
    name: names.get(combo.code) ?? combo.code,
    year: combo.year,
  }
}

export function pickSurprise(
  data: SurpriseData,
  eras: SurpriseEra[],
  seen: Set<string>,
): SurpriseTarget | null {
  const { countryCounts, stateCounts, countryNames } = data
  let fallback: SurpriseTarget | null = null

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const roll = Math.random()
    const target =
      roll < 0.3
        ? documentedPick(eras, countryNames)
        : roll < 0.7
          ? countryPick(countryCounts, countryNames, SUBSTANTIAL_RELEASES)
          : roll < 0.9
            ? statePick(stateCounts)
            : sparsePick(countryCounts, countryNames)
    if (!target) continue
    if (!seen.has(`${target.code}:${target.year}`)) return target
    fallback = target
  }
  // Session so long every draw repeats? A repeat beats a dead button.
  return fallback
}
