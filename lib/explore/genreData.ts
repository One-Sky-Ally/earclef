/**
 * The genre lens dataset: where each genre's artists emerged, by
 * country and decade (precomputed by scripts/build-genre-data.mjs).
 * Loads once client-side; absent file = lens hidden, globe unchanged.
 */

export const GENRE_LENSES = [
  'jazz',
  'blues',
  'folk',
  'reggae',
  'punk',
  'metal',
  'hip hop',
  'techno',
  'bossa nova',
  'k-pop',
] as const

export type GenreLens = (typeof GENRE_LENSES)[number]

export function isGenreLens(value: unknown): value is GenreLens {
  return (
    typeof value === 'string' && (GENRE_LENSES as readonly string[]).includes(value)
  )
}

/** country → decade (e.g. "1960") → artists who emerged. */
export type GenreCountryDecades = Record<string, Record<string, number>>

export interface GenreEmergenceData {
  meta: { completed: string[]; generatedAt?: string }
  genres: Record<string, GenreCountryDecades>
}

export async function loadGenreData(): Promise<GenreEmergenceData | null> {
  try {
    const res = await fetch('/data/genre-artist-emergence.json')
    if (!res.ok) return null
    const data = (await res.json()) as GenreEmergenceData
    return Object.keys(data.genres ?? {}).length > 0 ? data : null
  } catch {
    return null
  }
}

/**
 * Emerged-artist count for a country across the selected years. Decade
 * resolution: a decade counts when it overlaps the range at all — the
 * UI labels the lens honestly.
 */
export function genreCountInRange(
  byDecade: Record<string, number> | undefined,
  start: number,
  end: number,
): number {
  if (!byDecade) return 0
  let total = 0
  for (const [decade, count] of Object.entries(byDecade)) {
    const decadeStart = Number(decade)
    if (decadeStart + 9 >= start && decadeStart <= end) total += count
  }
  return total
}

export function genreMaxForRange(
  countries: GenreCountryDecades,
  start: number,
  end: number,
): number {
  let max = 0
  for (const byDecade of Object.values(countries)) {
    const value = genreCountInRange(byDecade, start, end)
    if (value > max) max = value
  }
  return max
}
