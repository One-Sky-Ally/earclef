/**
 * The in-player genre filter: which tracks a running queue plays.
 *
 * Two modes, because "switch this off" and "play only this" are
 * different questions:
 *
 * - `except` — play everything but these. Excluding a genre hides
 *   EVERY track whose artist carries it, not just tracks where it is
 *   the leading tag: switching off "metal" means the metal artists,
 *   and a band tagged [black metal, rock] is one of them. An untagged
 *   track is never excluded — nothing says it is metal.
 * - `only` — play just these. A track plays when its artist carries
 *   ANY of them, so "only highlife" keeps a band tagged
 *   [highlife, afrobeat]. An untagged track does NOT play: missing is
 *   not a match (standing lesson 5) — nothing says it is highlife.
 *
 * `only` with one genre is exactly the panel's genre chip
 * (`artist.tags.includes(genre)`), which is what lets the chip hand a
 * queue its starting filter and the two controls agree.
 *
 * Pure so the rule is checkable on its own, apart from the iframe
 * and fill engine around it.
 */

export type QueueGenreFilter =
  | { mode: 'except'; genres: ReadonlySet<string> }
  | { mode: 'only'; genres: ReadonlySet<string> }

/** Every genre on — the default, and "All on". */
export const ALL_GENRES: QueueGenreFilter = { mode: 'except', genres: new Set() }

export function onlyGenre(genre: string): QueueGenreFilter {
  return { mode: 'only', genres: new Set([genre]) }
}

/** The filter a queue starts under, from the panel's genre chip. */
export function filterForPanelGenre(
  panelGenre: string | null | undefined,
): QueueGenreFilter {
  return panelGenre ? onlyGenre(panelGenre) : ALL_GENRES
}

export function isAllGenres(filter: QueueGenreFilter): boolean {
  return filter.mode === 'except' && filter.genres.size === 0
}

/** Does a track (or an artist, by their tags) play under this filter? */
export function genresIncluded(
  genres: readonly string[] | undefined,
  filter: QueueGenreFilter,
): boolean {
  const tags = genres ?? []
  if (filter.mode === 'except') {
    return !tags.some((genre) => filter.genres.has(genre))
  }
  return tags.some((genre) => filter.genres.has(genre))
}

/** Is this genre's row shown as switched on? */
export function genreOn(genre: string, filter: QueueGenreFilter): boolean {
  return filter.mode === 'except'
    ? !filter.genres.has(genre)
    : filter.genres.has(genre)
}

/**
 * Flip one genre's row. In `except` mode that adds or removes an
 * exclusion; in `only` mode it adds or removes a genre from the set
 * being played. An `only` set emptied by the listener stays an empty
 * `only` — every genre off — rather than silently becoming "all on".
 */
export function toggleGenre(
  genre: string,
  filter: QueueGenreFilter,
): QueueGenreFilter {
  const next = new Set(filter.genres)
  if (next.has(genre)) next.delete(genre)
  else next.add(genre)
  return { mode: filter.mode, genres: next }
}

/** Does this filter say the same thing as the panel's chip? */
export function matchesPanelGenre(
  filter: QueueGenreFilter,
  panelGenre: string | null,
): boolean {
  if (panelGenre === null) return isAllGenres(filter)
  return (
    filter.mode === 'only' &&
    filter.genres.size === 1 &&
    filter.genres.has(panelGenre)
  )
}
