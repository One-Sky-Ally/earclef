import corrections from './origin-corrections.json'
import type { PoolArtist } from './panelData'

/**
 * Origin corrections: MusicBrainz's artist `country:` search field is
 * derived from the artist's AREA — current residence or citizenship —
 * not from where their music began. Tina Turner (born Nutbush,
 * Tennessee; Swiss citizen late in life) therefore topped Switzerland's
 * pool. This is the same origin-over-distribution rule locked in
 * 9d97588, one layer deeper: residence isn't origin either.
 *
 * scripts/build-origin-corrections.mjs resolves each pooled artist's
 * begin-area up MusicBrainz's own "part of" chain to a country and
 * commits the verdicts here. A move only exists when a begin-area
 * RESOLVES to a different country — no begin-area means no opinion,
 * and the artist is left exactly where MusicBrainz put them.
 */

export interface OriginMove {
  /** Country whose pool wrongly claims them (residence/citizenship). */
  from: string
  /** Country their music actually began in (resolved birthplace). */
  to: string
  name: string
  begin: string | null
  end: string | null
  weight: number
  tags: string[]
  beginArea: string | null
}

const DATASET = corrections as unknown as {
  generatedAt: string | null
  moves: Record<string, OriginMove>
}

const byFrom = new Map<string, Set<string>>()
const byTo = new Map<string, { mbid: string; move: OriginMove }[]>()

for (const [mbid, move] of Object.entries(DATASET.moves ?? {})) {
  const leaving = byFrom.get(move.from) ?? new Set<string>()
  leaving.add(mbid)
  byFrom.set(move.from, leaving)

  const arriving = byTo.get(move.to) ?? []
  arriving.push({ mbid, move })
  byTo.set(move.to, arriving)
}

/** MBIDs this country's pool must not claim. */
export function movedOut(country: string): Set<string> {
  return byFrom.get(country) ?? new Set()
}

/**
 * Artists this country should claim instead — carrying the tag weight
 * and life-span the sweep recorded, so they rank and era-filter
 * exactly like any other pooled artist.
 */
export function movedIn(
  country: string,
  rangeStart: number,
  rangeEnd: number,
  personCareerOffset: number,
): { artist: PoolArtist; weight: number }[] {
  const arrivals = byTo.get(country) ?? []
  return arrivals.flatMap(({ mbid, move }) => {
    const beginYear = Number(move.begin)
    // Same era gate the live pool applies: began by the range's end,
    // didn't end before it started. Undated artists stay eligible.
    if (Number.isFinite(beginYear)) {
      const careerStart = beginYear + personCareerOffset
      if (careerStart > rangeEnd) return []
    }
    const endYear = Number(move.end)
    if (Number.isFinite(endYear) && endYear < rangeStart) return []
    return [
      {
        artist: { id: mbid, name: move.name, tags: move.tags },
        weight: move.weight,
      },
    ]
  })
}

export function moveCount(): number {
  return Object.keys(DATASET.moves ?? {}).length
}
