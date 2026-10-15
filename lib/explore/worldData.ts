/**
 * The Explore views' shared world data — the country shapes and the
 * per-country release counts — fetched and parsed ONCE per page, then
 * shared by the 3D globe, the flat map and the list. All three read
 * the same files, so switching views never refetches.
 */
import { loadCounts, type CountryYearCounts, type DataSource } from './counts'
import type { CountryFeature } from './geo'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The countries dataset, with backoff retries. Later attempts add a
 * cache-busting query so a poisoned browser/proxy cache of the static
 * asset can't make the failure permanent.
 */
async function fetchCountries(): Promise<{ features: CountryFeature[] }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bust = attempt > 1 ? `?retry=${attempt}` : ''
      const res = await fetch(`/data/countries-110m.geojson${bust}`)
      if (!res.ok) throw new Error(`countries geojson: HTTP ${res.status}`)
      return (await res.json()) as { features: CountryFeature[] }
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(800 * attempt)
    }
  }
  throw lastError
}

let countriesPromise: Promise<{ features: CountryFeature[] }> | null = null

/** Shared country shapes. Treat the result as read-only. */
export function loadCountryShapes(): Promise<{ features: CountryFeature[] }> {
  if (!countriesPromise) {
    countriesPromise = fetchCountries().catch((error: unknown) => {
      // A failed load may be retried by the next caller.
      countriesPromise = null
      throw error
    })
  }
  return countriesPromise
}

let countsPromise: Promise<{
  counts: CountryYearCounts
  source: DataSource
}> | null = null

/** Shared release counts (simulated only if the real file is missing). */
export function loadSharedCounts(
  codes: string[],
): Promise<{ counts: CountryYearCounts; source: DataSource }> {
  if (!countsPromise) countsPromise = loadCounts(codes)
  return countsPromise
}
