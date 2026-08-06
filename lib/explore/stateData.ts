import stateArtists from './state-artists.json'
import type { CountryYearDetails, PanelArtist } from './panelData'

/**
 * State panels are served from the committed precomputed dataset —
 * the same serve-from-file pattern as playing.json and genre stories.
 * scripts/build-state-data.mjs sweeps MusicBrainz (area + beginarea
 * discovery, parent-walk state assignment) and commits the result, so
 * a state click answers in milliseconds with zero MusicBrainz runtime
 * dependency, for any year span.
 */

interface StoredArtist {
  id: string
  name: string
  /** Career-start year (persons: birth +15, live-route parity); null = undated. */
  cs: number | null
  end: number | null
  /** MusicBrainz tag-vote weight — the significance ranking. */
  w: number
  /** Top tag names, for the genre lens. */
  t: string[]
}

interface StoredState {
  total: number
  undated: number
  /** Career-start year → artists who emerged then (uncapped). */
  begins: Record<string, number>
  /** End year → artists who ended then (uncapped). */
  ends: Record<string, number>
  /** Capped roster: top overall ∪ top per decade, weight-ranked. */
  artists: StoredArtist[]
}

const DATASET = stateArtists as unknown as {
  generatedAt: string | null
  states: Record<string, StoredState>
}

const ARTIST_LIMIT = 12

/**
 * Undated MusicBrainz artists are overwhelmingly modern self-registered
 * acts. Treating "no dates" as "active in 1955" put bedroom producers
 * in front of Delta bluesmen — so spans that end before the digital
 * era exclude the undated entirely (list AND count), and spans that
 * include it rank them after every era-documented artist.
 */
const UNDATED_MODERN_FLOOR = 1980

export function hasStateData(code: string): boolean {
  return Boolean(DATASET.states[code])
}

function activeInRange(artist: StoredArtist, start: number, end: number): boolean {
  if (artist.cs !== null && artist.cs > end) return false
  if (artist.end !== null && artist.end < start) return false
  return true
}

/**
 * Active-artist total for a span, from the uncapped histograms:
 * everyone who began by the span's end, minus everyone gone before it
 * started, plus the undated (always counted, live-route parity).
 */
function activeCount(
  state: StoredState,
  start: number,
  end: number,
  includeUndated: boolean,
): number {
  let began = 0
  for (const [year, count] of Object.entries(state.begins)) {
    if (Number(year) <= end) began += count
  }
  let gone = 0
  for (const [year, count] of Object.entries(state.ends)) {
    if (Number(year) < start) gone += count
  }
  return began - gone + (includeUndated ? state.undated : 0)
}

export function stateDetails(
  code: string,
  start: number,
  end: number,
  genre: string | null,
): CountryYearDetails | null {
  const state = DATASET.states[code]
  if (!state) return null

  const lens = genre?.toLowerCase() ?? null
  const includeUndated = end >= UNDATED_MODERN_FLOOR
  const matching = state.artists.filter(
    (artist) =>
      activeInRange(artist, start, end) &&
      (includeUndated || artist.cs !== null) &&
      (!lens || artist.t.some((tag) => tag.toLowerCase() === lens)),
  )
  // Era-documented artists outrank the undated; weight order within each.
  const top: PanelArtist[] = [
    ...matching.filter((artist) => artist.cs !== null),
    ...matching.filter((artist) => artist.cs === null),
  ]
    .slice(0, ARTIST_LIMIT)
    .map((artist) => ({ id: artist.id, name: artist.name }))

  return {
    // Genre totals count the stored roster only — an honest floor; the
    // full histograms carry no tags.
    totalCount: lens
      ? matching.length
      : activeCount(state, start, end, includeUndated),
    originArtists: top,
    artists: [],
    releases: [],
  }
}
