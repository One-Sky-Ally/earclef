import type { CountryYearDetails, PanelArtist, PoolArtist } from './panelData'
import { movedIn, movedOut } from './originCorrections'
import { canonicalizeTags } from './genreFamilies'
import countryIndex from './country-artists-index.json'

/**
 * Country panels served from the committed precompute — the same
 * serve-from-file pattern the US states and UK nations have used since
 * August, and the reason those panels have never touched MusicBrainz at
 * runtime. scripts/build-country-data.mjs sweeps and commits one
 * compact record per artist; the panel for any year span and any genre
 * lens is DERIVED here, so nothing is stored per combo and the 22,225
 * country×year combinations never materialise.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN: the releases-derived credits
 * list. That list is built from releases carrying a country code, and
 * digital distributions enumerate every territory on earth — which is
 * how clicking Antarctica returned 67 artists including Alanis
 * Morissette, and the Falklands returned Childish Gambino. Owner ruling
 * (Aug 2026): it has been the poisoned layer since day one, and losing
 * it is a gain. Serving origin artists only deletes that whole class.
 *
 * The queue resolver still calls MusicBrainz per artist. This removes
 * MusicBrainz from BROWSING, not from PLAYING.
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

interface StoredCountry {
  name: string
  /** MusicBrainz's own total for the country, cap or no cap. */
  total: number
  /** Artists actually stored before the cap; the histograms cover these. */
  inspected: number
  /** The 2,000 cap bit — spans report a floor rather than a count. */
  truncated: boolean
  undated: number
  begins: Record<string, number>
  ends: Record<string, number>
  artists: StoredArtist[]
}

const AVAILABLE = new Set((countryIndex as { codes: string[] }).codes)

const ARTIST_LIMIT = 12
/** Discovery-pool cap — the panel's tiers/chips/search work on these. */
const POOL_LIMIT = 300
/** Live-route parity for origin corrections. */
const PERSON_CAREER_OFFSET_YEARS = 15
/** Matches POOL_TAG_LIMIT on the live route, so pools look identical. */
const POOL_TAG_LIMIT = 4

/**
 * Undated MusicBrainz artists are overwhelmingly modern self-registered
 * acts. Treating "no dates" as "active in 1955" put bedroom producers
 * in front of Delta bluesmen — so spans that end before the digital era
 * exclude the undated entirely, and spans that include it rank them
 * after every era-documented artist. Identical to the state path.
 */
const UNDATED_MODERN_FLOOR = 1980

export function hasCountryData(code: string): boolean {
  return AVAILABLE.has(code)
}

/**
 * Per-country dynamic import: webpack splits each country into its own
 * chunk, so a request parses ONE country (~100 KB) instead of the whole
 * 17.5 MB dataset. A single static import would put that parse on every
 * cold start of every function that touches this module.
 */
const cache = new Map<string, StoredCountry | null>()

async function loadCountry(code: string): Promise<StoredCountry | null> {
  const cached = cache.get(code)
  if (cached !== undefined) return cached
  let stored: StoredCountry | null = null
  try {
    // Template literal, not a variable path: webpack needs to see the
    // directory to trace every country file into the deployment.
    const loaded = await import(`./country-artists/${code}.json`)
    stored = (loaded.default ?? loaded) as StoredCountry
  } catch {
    // Missing file = no opinion; the caller falls through to live MB.
    stored = null
  }
  cache.set(code, stored)
  return stored
}

function activeInRange(
  artist: StoredArtist,
  start: number,
  end: number,
): boolean {
  if (artist.cs !== null && artist.cs > end) return false
  if (artist.end !== null && artist.end < start) return false
  return true
}

/**
 * Active-artist total for a span from the uncapped histograms:
 * everyone who began by the span's end, minus everyone gone before it
 * started, plus the undated. For a capped country the histograms cover
 * only what was stored, so this is an honest floor rather than a count
 * — `truncated` says which it is.
 */
function activeCount(
  stored: StoredCountry,
  start: number,
  end: number,
  includeUndated: boolean,
): number {
  let began = 0
  for (const [year, count] of Object.entries(stored.begins)) {
    if (Number(year) <= end) began += count
  }
  let gone = 0
  for (const [year, count] of Object.entries(stored.ends)) {
    if (Number(year) < start) gone += count
  }
  return began - gone + (includeUndated ? stored.undated : 0)
}

export async function countryDetails(
  code: string,
  start: number,
  end: number,
  genre: string | null,
): Promise<CountryYearDetails | null> {
  const stored = await loadCountry(code)
  if (!stored) return null

  const lens = genre?.toLowerCase() ?? null
  const includeUndated = end >= UNDATED_MODERN_FLOOR

  /**
   * Origin corrections at read time, exactly as the live route applies
   * them: MusicBrainz's `country:` field follows residence, so Tina
   * Turner topped Switzerland. Applied HERE rather than baked into the
   * dataset so the two files keep independent refresh cycles — a
   * corrections rebuild takes effect without re-sweeping 175 countries.
   */
  const leaving = movedOut(code)
  const matching = stored.artists.filter(
    (artist) =>
      !leaving.has(artist.id) &&
      activeInRange(artist, start, end) &&
      (includeUndated || artist.cs !== null) &&
      (!lens || artist.t.some((tag) => tag.toLowerCase() === lens)),
  )

  const arrivals = movedIn(code, start, end, PERSON_CAREER_OFFSET_YEARS)
    .filter(({ artist }) => !lens || artist.tags.includes(lens))
    .filter(({ artist }) => !matching.some((held) => held.id === artist.id))
    .map(({ artist, weight }) => ({
      id: artist.id,
      name: artist.name,
      cs: null,
      end: null,
      w: weight,
      t: artist.tags,
    }))

  const pooled = [...matching, ...arrivals].sort((a, b) => b.w - a.w)
  // Era-documented artists outrank the undated; weight order within each.
  const ordered = [
    ...pooled.filter((artist) => artist.cs !== null),
    ...pooled.filter((artist) => artist.cs === null),
  ]

  const top: PanelArtist[] = ordered
    .slice(0, ARTIST_LIMIT)
    .map((artist) => ({ id: artist.id, name: artist.name }))
  const pool: PoolArtist[] = ordered.slice(0, POOL_LIMIT).map((artist) => ({
    id: artist.id,
    name: artist.name,
    /**
     * Canonicalized at READ time, not baked into the dataset, so a
     * genre-families vocabulary change takes effect without re-sweeping
     * 175 countries — the same reasoning as the origin corrections
     * above. The live route does this server-side before its own
     * four-tag cut; matching the cut keeps the two pools identical.
     * Without it Aly Bouchnak arrives as four kids-music fragments
     * instead of one "kids music" chip.
     */
    tags: canonicalizeTags(artist.t).slice(0, POOL_TAG_LIMIT),
  }))

  return {
    // Genre totals count the stored roster only — an honest floor; the
    // histograms carry no tags. Same caveat as the state path.
    totalCount: lens
      ? matching.length
      : activeCount(stored, start, end, includeUndated),
    originArtists: top,
    panelArtists: pool,
    // Deliberately empty — see the note at the top of this file.
    artists: [],
    releases: [],
  }
}
