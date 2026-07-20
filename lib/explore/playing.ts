/**
 * "What was playing" — cultural-relevance snapshots per country + era.
 *
 * Data lives in lib/explore/playing.json, generated IN-SESSION in Claude
 * Code (zero-wallet), verified against the cited sources, committed, and
 * served from the file forever. Coverage is deliberately incomplete:
 * honest-sparse beats fake-full, and combos are added as documented
 * history surfaces.
 */

export interface PlayingItem {
  artist: string
  work: string
  note?: string
}

export interface PlayingSource {
  label: string
  url: string
}

export interface PlayingEntry {
  /** ISO 3166-1 alpha-2, matching the globe's country codes. */
  country: string
  from: number
  to: number
  /** Era display name, e.g. "Rocksteady into reggae". */
  era: string
  /**
   * charted — backed by a national chart archive (chart facts only);
   * documented — no usable chart existed; drawn from documented scene
   * history, radio programming, and reputable retrospectives.
   */
  kind: 'charted' | 'documented'
  /** One honest sentence on where this snapshot comes from. */
  basis: string
  /** Short story; [[Artist Name]] segments become listen links. */
  story: string
  items: PlayingItem[]
  sources: PlayingSource[]
  model: string
  at: string
}

interface PlayingFile {
  entries: PlayingEntry[]
}

/**
 * Best entry for a country + selected year range: the overlapping era
 * whose span most closely matches the selection (Jaccard on years), so
 * a 1970 pin finds "1965–1975" and a full-century sweep still returns
 * something sensible. Null when nothing overlaps.
 */
export function findPlayingEntry(
  entries: PlayingEntry[],
  country: string,
  from: number,
  to: number,
): PlayingEntry | null {
  const code = country.toUpperCase()
  let best: PlayingEntry | null = null
  let bestScore = 0
  for (const entry of entries) {
    if (entry.country !== code) continue
    const overlap =
      Math.min(entry.to, to) - Math.max(entry.from, from) + 1
    if (overlap <= 0) continue
    const union =
      Math.max(entry.to, to) - Math.min(entry.from, from) + 1
    const score = overlap / union
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  return best
}

export function countriesCovered(entries: PlayingEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.country))
}

export type { PlayingFile }
