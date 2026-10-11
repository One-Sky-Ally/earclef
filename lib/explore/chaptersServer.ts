/**
 * SERVER-ONLY merge of Artist Chapters into a panel response — the
 * presence model's edges (lib/explore/chapters.ts), read from
 * lib/explore/presence-edges.json, which scripts/build-presence-edges.mjs
 * writes from the owner-ruled corpus, origin corrections, verified
 * recording places, Wikidata and MusicBrainz passes.
 *
 * Two things happen at respond time (the extraArtists pattern — never
 * into memo/Blobs, so an edges rebuild rides each deploy):
 *
 *   1. Every pool row whose artist has chapters gets its line
 *      ("Burkina Faso · Paris 1985–2002") and, separately, its recorded
 *      sessions line.
 *   2. Artists a DATED based chapter places in THIS country for the
 *      span arrive as full pool members — same pill, same play
 *      resolver, counted here too (presences, not persons) — appended
 *      after the pool in the file's order (no cross-source ranking
 *      invented). Undated chapters never arrive: line only.
 *
 * Nothing is removed and nothing moves: the artist's own entry stays
 * exactly where it is; a chapter only adds.
 */
import edges from './presence-edges.json'
import {
  chapterLine,
  placesArtistIn,
  recordedLine,
  type ArtistChapters,
} from './chapters'
import { shapedExtraArtist } from './extraArtistsServer'
import type { CountryYearDetails, ExtraPoolArtist, PoolArtist } from './panelData'

const DATASET = edges as unknown as {
  generatedAt: string | null
  /** Artist key → chapters. MusicBrainz artists key by MBID; gap-fill entries by play key (dg:/wd:/nm:). */
  artists: Record<string, ArtistChapters>
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Country → the artist keys with a dated based chapter there (built once). */
let arrivalsByCountry: Map<string, string[]> | null = null

function arrivalsFor(code: string): string[] {
  if (!arrivalsByCountry) {
    arrivalsByCountry = new Map()
    for (const [key, artist] of Object.entries(DATASET.artists)) {
      const seen = new Set<string>()
      for (const chapter of artist.chapters) {
        if (chapter.kind !== 'based' || chapter.from == null || seen.has(chapter.country)) continue
        seen.add(chapter.country)
        const list = arrivalsByCountry.get(chapter.country) ?? []
        list.push(key)
        arrivalsByCountry.set(chapter.country, list)
      }
    }
  }
  return arrivalsByCountry.get(code) ?? []
}

/** The edges key for a pool row: MBID as is, gap-fill rows by their play key. */
function keyOf(artist: PoolArtist & { playKey?: string }): string {
  return artist.playKey ?? artist.id
}

function lines(artist: ArtistChapters): Pick<PoolArtist, 'chapterLine' | 'recordedLine'> {
  const line = chapterLine(artist.homeName, artist.chapters)
  const recorded = recordedLine(artist.chapters)
  return {
    ...(line ? { chapterLine: line } : {}),
    ...(recorded ? { recordedLine: recorded } : {}),
  }
}

function withLines<T extends PoolArtist & { playKey?: string }>(rows: T[]): T[] {
  return rows.map((row) => {
    const found = DATASET.artists[keyOf(row)]
    return found ? { ...row, ...lines(found) } : row
  })
}

/**
 * Attach chapter lines to every row and bring in the artists a dated
 * chapter places here for the span. No-ops on stored pre-pool payloads
 * (no panelArtists to join — the standard degradation) and for a lens
 * the artist's tags don't carry.
 */
export function withChapters(
  details: CountryYearDetails,
  code: string,
  yearStart: number,
  yearEnd: number,
  genre: string | null,
): CountryYearDetails {
  const lensOk = (tags: string[]) => !genre || tags.includes(genre)
  const extra = details.extraArtists
  const base: CountryYearDetails = {
    ...details,
    ...(details.panelArtists ? { panelArtists: withLines(details.panelArtists) } : {}),
    ...(extra
      ? {
          extraArtists: {
            ...extra,
            dated: withLines(extra.dated),
            undated: withLines(extra.undated),
            ...(extra.archive ? { archive: withLines(extra.archive) } : {}),
          },
        }
      : {}),
  }
  if (!base.panelArtists) return base

  const present = new Set<string>([
    ...base.panelArtists.map((artist) => artist.id),
    ...(base.extraArtists?.dated ?? []).map((artist) => artist.id),
    ...(base.extraArtists?.undated ?? []).map((artist) => artist.id),
  ])
  const mbArrivals: PoolArtist[] = []
  const extraArrivals: ExtraPoolArtist[] = []
  for (const key of arrivalsFor(code)) {
    const artist = DATASET.artists[key]
    if (!artist || artist.home === code) continue
    if (!artist.chapters.some((chapter) => chapter.country === code && placesArtistIn(chapter, yearStart, yearEnd))) continue
    if (MBID.test(key)) {
      if (present.has(key) || !lensOk(artist.tags ?? [])) continue
      mbArrivals.push({ id: key, name: artist.name, tags: artist.tags ?? [], ...lines(artist), chapterHere: true })
    } else {
      const shaped = shapedExtraArtist(key)
      if (!shaped || present.has(shaped.id) || !lensOk(shaped.tags)) continue
      // A chapter is dated by its source: the arrival is never "undated".
      const { undated: _undated, ...dated } = shaped
      extraArrivals.push({ ...dated, ...lines(artist), chapterHere: true })
    }
  }
  if (mbArrivals.length === 0 && extraArrivals.length === 0) return base
  return {
    ...base,
    totalCount: base.totalCount + mbArrivals.length + extraArrivals.length,
    panelArtists: [...base.panelArtists, ...mbArrivals],
    ...(extraArrivals.length > 0
      ? {
          extraArtists: {
            dated: [...(base.extraArtists?.dated ?? []), ...extraArrivals],
            undated: base.extraArtists?.undated ?? [],
            ...(base.extraArtists?.archive ? { archive: base.extraArtists.archive } : {}),
            ...(base.extraArtists?.undatedOmitted ? { undatedOmitted: base.extraArtists.undatedOmitted } : {}),
          },
        }
      : {}),
  }
}

export function chapterArtistCount(): number {
  return Object.keys(DATASET.artists).length
}
