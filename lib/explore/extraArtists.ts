import extraArtists from './extra-artists.json'
import { recoveredDiscogsId } from './extraPlay'

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
  /**
   * Alternate spellings: owner-attested (K. Viseth's variants) and,
   * since the v2 structured-credits rebuild, Discogs ANVs. Exact-match
   * material for resolution — never display.
   */
  aliases?: string[]
  /**
   * Entry kept from an earlier sweep after Discogs's country index
   * dropped its release (index drift) — see retain-drift-dropped.mjs.
   */
  retainedFrom?: string
}

const DATASET = extraArtists as unknown as {
  generatedAt: string | null
  countries: Record<string, ExtraArtist[]>
}

/** How far either side of a documented span still counts as the era. */
const ERA_REACH = 5

export function hasExtraArtists(code: string): boolean {
  return (DATASET.countries[code]?.length ?? 0) > 0
}

export interface ExtraArtistGroups {
  /** Documented as active in this era (release span ±5 years). */
  dated: ExtraArtist[]
  /**
   * Carry no date in the source at all — common for exactly the
   * vintage regional pressings this fills in (82 of 99 Laotian acts).
   * They are real artists from the place but cannot be tied to a year,
   * so the panel sorts them last and tags them "undated" rather than
   * implying they are the selected year's music.
   */
  undated: ExtraArtist[]
}

/**
 * Era split for a place+year. Uncapped — the panel's tiers and its
 * 100-pill render cap do the limiting, exactly as they do for the
 * MusicBrainz pool these merge into.
 */
export function extraArtistsFor(code: string, year: number): ExtraArtistGroups {
  const all = DATASET.countries[code] ?? []
  return {
    dated: all.filter(
      (artist) =>
        artist.firstYear !== null &&
        year >= artist.firstYear - ERA_REACH &&
        year <= (artist.lastYear ?? artist.firstYear) + ERA_REACH,
    ),
    undated: all.filter((artist) => artist.firstYear === null),
  }
}

/** Where an entry's pill points: its own page on the source that has it. */
export function extraArtistUrl(artist: ExtraArtist): string {
  if (artist.discogsArtistId) return discogsArtistUrl(artist.discogsArtistId)
  if (artist.wikidataId) return wikidataUrl(artist.wikidataId)
  // Id-less credits: the enrichment sweep may have recovered their
  // Discogs artist id by exact alias match — link the real page then.
  const recovered = recoveredDiscogsId(extraPlayKey(artist))
  if (recovered) return discogsArtistUrl(recovered)
  return discogsSearchUrl(artist.name)
}

/**
 * Stable key for the verified-play resolver (/api/play/[key]). Names in
 * non-Latin scripts (most of the Lao pool) slug to nothing, so id-less
 * entries key on a djb2 hash of the raw name instead.
 */
export function extraPlayKey(artist: ExtraArtist): string {
  if (artist.discogsArtistId) return `dg:${artist.discogsArtistId}`
  if (artist.wikidataId) return `wd:${artist.wikidataId}`
  const slug = artist.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `nm:${slug || `h${djb2(artist.name)}`}`
}

function djb2(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

export function discogsArtistUrl(id: number | string): string {
  return `https://www.discogs.com/artist/${id}`
}

export function wikidataUrl(id: string): string {
  return `https://www.wikidata.org/wiki/${id}`
}

/**
 * Search fallback when we could not resolve an artist page. ALL
 * sections, not type=artist: credit-string names often have no artist
 * page while their release still shows — the artist-only tab returned
 * "No items match" for names the release tab documents (Aug 8 report).
 */
export function discogsSearchUrl(name: string): string {
  return `https://www.discogs.com/search/?q=${encodeURIComponent(name)}`
}
