/**
 * SERVER-ONLY access to the gap-fill dataset. The JSON behind this
 * module is 18k+ artists (~5.6 MB raw) — it must NEVER be imported
 * from client code: a static import here is what shipped the whole
 * planet to every browser and burned the Aug 2026 Netlify bandwidth
 * budget. Client components receive already-SHAPED entries for one
 * country via /api/explore/[country]/[year] instead.
 *
 * Gap-fill artists are acts from sparse-coverage countries that
 * MusicBrainz has no record of, gathered from Discogs and Wikidata by
 * scripts/build-extra-artists.mjs. They NEVER merge into MusicBrainz
 * lists or counts as data — but they render as ONE pool to visitors
 * (same pill, same tiers); the difference is only where a pill points.
 */
import extraArtists from './extra-artists.json'
import { recoveredDiscogsId } from './extraPlay'
import type { ExtraPoolArtist } from './panelData'

interface ExtraArtist {
  name: string
  source: 'discogs' | 'wikidata'
  firstYear: number | null
  lastYear: number | null
  styles: string[]
  releaseCount: number
  discogsArtistId: number | string | null
  wikidataId: string | null
  aliases?: string[]
  retainedFrom?: string
  note?: string
  /**
   * Presence-model edge kind (Aug 2026). Absent = presumed-local (the
   * approved gap-fill default). 'archive' = identity established but
   * origin affirmatively unestablished: the records were verified
   * pressed here, and that is the whole claim — rendered under the
   * honest divider, excluded from the pool, its count, the genre
   * filter and rankings. Never deleted for being unknown.
   */
  presence?: 'archive'
}

const DATASET = extraArtists as unknown as {
  generatedAt: string | null
  countries: Record<string, ExtraArtist[]>
}

/** How far either side of a documented span still counts as the era. */
const ERA_REACH = 5

/**
 * Era split for a place + year span, SHAPED for the panel: the pill
 * URL and verified-play key are computed here so the client needs no
 * dataset access at all. Sort order inside each group is preserved
 * from the committed dataset (press-count order).
 */
export function extraArtistGroupsFor(
  code: string,
  yearStart: number,
  yearEnd: number,
): {
  dated: ExtraPoolArtist[]
  undated: ExtraPoolArtist[]
  archive: ExtraPoolArtist[]
} {
  const pool = (DATASET.countries[code] ?? []).filter(
    (artist) => artist.presence !== 'archive',
  )
  // Archive edges: same era gate as the pool (pressing years are real
  // dates of real objects), dated-in-span first, undated after. They
  // ship as their own group so the client can render the divider and
  // keep them out of every count.
  const archiveAll = (DATASET.countries[code] ?? []).filter(
    (artist) => artist.presence === 'archive',
  )
  const shape = (artist: ExtraArtist, undated: boolean): ExtraPoolArtist => {
    const playKey = extraPlayKey(artist)
    return {
      id: `x:${playKey}`,
      name: artist.name,
      tags: artist.styles.map((style) => style.toLowerCase()),
      externalUrl: extraArtistUrl(artist, playKey),
      playKey,
      ...(undated ? { undated: true as const } : {}),
    }
  }
  const inSpan = (artist: ExtraArtist) =>
    artist.firstYear !== null &&
    yearEnd >= artist.firstYear - ERA_REACH &&
    yearStart <= (artist.lastYear ?? artist.firstYear) + ERA_REACH
  return {
    dated: pool.filter(inSpan).map((artist) => shape(artist, false)),
    undated: pool
      .filter((artist) => artist.firstYear === null)
      .map((artist) => shape(artist, true)),
    archive: [
      ...archiveAll.filter(inSpan).map((artist) => shape(artist, false)),
      ...archiveAll
        .filter((artist) => artist.firstYear === null)
        .map((artist) => shape(artist, true)),
    ],
  }
}

/** Where an entry's pill points: its own page on the source that has it. */
function extraArtistUrl(artist: ExtraArtist, playKey: string): string {
  if (artist.discogsArtistId) return discogsArtistUrl(artist.discogsArtistId)
  if (artist.wikidataId) return wikidataUrl(artist.wikidataId)
  // Id-less credits: the enrichment sweep may have recovered their
  // Discogs artist id by exact alias match — link the real page then.
  const recovered = recoveredDiscogsId(playKey)
  if (recovered) return discogsArtistUrl(recovered)
  return discogsSearchUrl(artist.name)
}

/**
 * Stable key for the verified-play resolver (/api/play/[key]). Names in
 * non-Latin scripts (most of the Lao pool) slug to nothing, so id-less
 * entries key on a djb2 hash of the raw name instead.
 */
function extraPlayKey(artist: ExtraArtist): string {
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

function discogsArtistUrl(id: number | string): string {
  return `https://www.discogs.com/artist/${id}`
}

function wikidataUrl(id: string): string {
  return `https://www.wikidata.org/wiki/${id}`
}

/**
 * Search fallback when we could not resolve an artist page. ALL
 * sections, not type=artist: credit-string names often have no artist
 * page while their release still shows (Aug 8 report).
 */
function discogsSearchUrl(name: string): string {
  return `https://www.discogs.com/search/?q=${encodeURIComponent(name)}`
}
