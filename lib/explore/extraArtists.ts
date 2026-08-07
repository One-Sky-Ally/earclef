import extraArtists from './extra-artists.json'

/**
 * Gap-fill artists: acts from sparse-coverage countries that
 * MusicBrainz has NO record of at all, gathered from Wikidata and
 * Discogs by scripts/build-extra-artists.mjs.
 *
 * These NEVER merge into the MusicBrainz lists or counts — the panel
 * shows them in their own clearly-labelled section, with link-outs to
 * the source that documents them. MB stays canonical.
 */

export interface ExtraArtist {
  name: string
  source: 'discogs' | 'wikidata'
  /** Earliest year we can document them (release or career start). */
  firstYear: number | null
  lastYear: number | null
  styles: string[]
  releaseCount: number
  discogsArtistId: number | string | null
  wikidataId: string | null
}

const DATASET = extraArtists as unknown as {
  generatedAt: string | null
  countries: Record<string, ExtraArtist[]>
}

/** How far either side of a documented span still counts as the era. */
const ERA_REACH = 5
const DATED_LIMIT = 10
const UNDATED_LIMIT = 6

export function hasExtraArtists(code: string): boolean {
  return (DATASET.countries[code]?.length ?? 0) > 0
}

export interface ExtraArtistGroups {
  /** Documented as active in this era (release span ±5 years). */
  dated: ExtraArtist[]
  /**
   * Carry no date in the source at all — common for exactly the
   * vintage regional pressings this fills in (82 of 99 Laotian acts).
   * They are NOT era matches and must never be presented as any given
   * year's music: the UI shows them under their own honest heading.
   */
  undated: ExtraArtist[]
  undatedTotal: number
}

export function extraArtistsFor(code: string, year: number): ExtraArtistGroups {
  const all = DATASET.countries[code] ?? []
  const dated = all.filter(
    (artist) =>
      artist.firstYear !== null &&
      year >= artist.firstYear - ERA_REACH &&
      year <= (artist.lastYear ?? artist.firstYear) + ERA_REACH,
  )
  const undated = all.filter((artist) => artist.firstYear === null)
  return {
    dated: dated.slice(0, DATED_LIMIT),
    undated: undated.slice(0, UNDATED_LIMIT),
    undatedTotal: undated.length,
  }
}

export function discogsArtistUrl(id: number | string): string {
  return `https://www.discogs.com/artist/${id}`
}

export function wikidataUrl(id: string): string {
  return `https://www.wikidata.org/wiki/${id}`
}

/** Search fallback when we could not resolve an artist page. */
export function discogsSearchUrl(name: string): string {
  return `https://www.discogs.com/search/?q=${encodeURIComponent(name)}&type=artist`
}
