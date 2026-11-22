/**
 * "On this day" sorting and filters (owner, Nov 22 2026): newest or
 * oldest first, and narrowing a day's list by year, place and genre.
 *
 * Pure and client-safe. Everything filters on what the list already
 * shows: the release's own year, the artist's country on the site (the
 * Country column), and the artist's genres as the Explore panels read
 * them. Nothing is inferred — a release with no genres on record simply
 * never matches a genre filter.
 */

export type OnThisDaySort = 'oldest' | 'newest'

export interface OnThisDayFilters {
  sort: OnThisDaySort
  /** '' = any year; 'pre2000'; 'd1960' = the 1960s; '1965' = that year. */
  year: string
  /** '' = any; else an artist country code (the Country column). */
  country: string
  /** '' = any; else one canonical genre tag. */
  genre: string
}

export const DEFAULT_FILTERS: OnThisDayFilters = {
  sort: 'oldest',
  year: '',
  country: '',
  genre: '',
}

/** The fields filtering reads — a subset of OnThisDayItem. */
export interface FilterableItem {
  y: number
  c: string
  genres: string[]
}

const YEAR_VALUE = /^(?:pre2000|d\d{4}|\d{4})$/

/** A year value as the URL may carry it, or '' when it is not one. */
export function parseYearFilter(value: string | null | undefined): string {
  return value && YEAR_VALUE.test(value) ? value : ''
}

export function parseSort(value: string | null | undefined): OnThisDaySort {
  return value === 'newest' ? 'newest' : 'oldest'
}

/** Filters from URL search params (?sort=newest&yr=d1960&loc=GB&g=jazz). */
export function filtersFromParams(get: (key: string) => string | null | undefined): OnThisDayFilters {
  const country = get('loc') ?? ''
  return {
    sort: parseSort(get('sort')),
    year: parseYearFilter(get('yr')),
    country: /^[A-Za-z0-9-]{1,12}$/.test(country) ? country : '',
    genre: (get('g') ?? '').slice(0, 80),
  }
}

/** The URL params for these filters; defaults are left out. */
export function filtersToParams(filters: OnThisDayFilters): Record<string, string | null> {
  return {
    sort: filters.sort === 'newest' ? 'newest' : null,
    yr: filters.year || null,
    loc: filters.country || null,
    g: filters.genre || null,
  }
}

export const hasActiveFilter = (filters: OnThisDayFilters) =>
  filters.year !== '' || filters.country !== '' || filters.genre !== ''

export function matchesYear(year: number, value: string): boolean {
  if (value === '') return true
  if (value === 'pre2000') return year < 2000
  if (value.startsWith('d')) {
    const decade = Number(value.slice(1))
    return year >= decade && year < decade + 10
  }
  return year === Number(value)
}

export function matchesFilters(item: FilterableItem, filters: OnThisDayFilters): boolean {
  return (
    matchesYear(item.y, filters.year) &&
    (filters.country === '' || item.c === filters.country) &&
    (filters.genre === '' || item.genres.includes(filters.genre))
  )
}

/**
 * The items that pass the filters, in the chosen order. The sort is by
 * year and stable, so releases of the same year keep the order the data
 * gives them (countries taking turns) either way.
 */
export function applyFilters<T extends FilterableItem>(items: readonly T[], filters: OnThisDayFilters): T[] {
  const kept = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesFilters(item, filters))
  kept.sort((a, b) =>
    a.item.y !== b.item.y
      ? filters.sort === 'newest'
        ? b.item.y - a.item.y
        : a.item.y - b.item.y
      : a.index - b.index,
  )
  return kept.map(({ item }) => item)
}

export interface FilterOption {
  value: string
  label: string
  count: number
}

export interface YearOptionGroup {
  /** The whole decade, e.g. { value: 'd1960', label: 'All of the 1960s' }. */
  decade: FilterOption
  years: FilterOption[]
}

/**
 * The choices each filter offers, counted over the items that pass the
 * OTHER filters — so every number says how many releases picking it
 * would show. A value already chosen stays offered (count 0) on a day
 * that has none, so the menu never silently changes what it says.
 */
export function filterOptions(
  items: readonly FilterableItem[],
  filters: OnThisDayFilters,
  countryName: (code: string) => string,
): {
  pre2000: number
  decades: YearOptionGroup[]
  countries: FilterOption[]
  genres: FilterOption[]
} {
  const forYears = items.filter((item) => matchesFilters(item, { ...filters, year: '' }))
  const forCountries = items.filter((item) => matchesFilters(item, { ...filters, country: '' }))
  const forGenres = items.filter((item) => matchesFilters(item, { ...filters, genre: '' }))

  const yearCounts = new Map<number, number>()
  for (const item of forYears) yearCounts.set(item.y, (yearCounts.get(item.y) ?? 0) + 1)
  const chosenYear = /^\d{4}$/.test(filters.year) ? Number(filters.year) : null
  if (chosenYear !== null && !yearCounts.has(chosenYear)) yearCounts.set(chosenYear, 0)
  const chosenDecade = filters.year.startsWith('d') ? Number(filters.year.slice(1)) : null

  const byDecade = new Map<number, FilterOption[]>()
  for (const [year, count] of [...yearCounts.entries()].sort(([a], [b]) => a - b)) {
    const decade = Math.floor(year / 10) * 10
    byDecade.set(decade, [...(byDecade.get(decade) ?? []), { value: String(year), label: String(year), count }])
  }
  if (chosenDecade !== null && !byDecade.has(chosenDecade)) byDecade.set(chosenDecade, [])
  const decades = [...byDecade.entries()]
    .sort(([a], [b]) => a - b)
    .map(([decade, years]) => ({
      decade: {
        value: `d${decade}`,
        label: `All of the ${decade}s`,
        count: years.reduce((sum, year) => sum + year.count, 0),
      },
      years,
    }))

  const tally = (values: string[][]) => {
    const counts = new Map<string, number>()
    for (const list of values) for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1)
    return counts
  }

  const countryCounts = tally(forCountries.map((item) => [item.c]))
  if (filters.country && !countryCounts.has(filters.country)) countryCounts.set(filters.country, 0)
  const countries = [...countryCounts.entries()]
    .map(([value, count]) => ({ value, label: countryName(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const genreCounts = tally(forGenres.map((item) => item.genres))
  if (filters.genre && !genreCounts.has(filters.genre)) genreCounts.set(filters.genre, 0)
  const genres = [...genreCounts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  return {
    pre2000: forYears.filter((item) => item.y < 2000).length,
    decades,
    countries,
    genres,
  }
}
