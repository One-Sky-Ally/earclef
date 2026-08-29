/**
 * Genre families: many MusicBrainz tags, one readable label.
 *
 * MB's tag vocabulary for a genre is written by hundreds of people and
 * fragments accordingly — the children's-music class alone is spelled
 * `kids`, `children`, `children's music`, `kids pop`, `nursery rhymes`,
 * `lullaby`, `kindie` and more, each a separate chip filtering a
 * separate subset. A family maps that vocabulary onto ONE label.
 *
 * What is hard-coded here is VOCABULARY — which words mean a genre —
 * never which artists. An artist joins a family because their own MB
 * record says so, and leaves it the day the record changes.
 *
 * `demote: true` marks a family that must not lead a place's queue
 * (owner ruling, Aug 2026): children's and educational music stay in
 * the queue, but never as the first thing a visitor hears when they
 * open a country. The queue enforces the position; this file only says
 * what the class IS.
 */
import familiesFile from './genre-families.json'

export interface GenreFamily {
  label: string
  demote: boolean
  tags: string[]
}

interface GenreFamiliesFile {
  version: number
  families: GenreFamily[]
}

export const GENRE_FAMILIES: GenreFamily[] = (
  familiesFile as GenreFamiliesFile
).families

/** MB tag (lowercased) → the family label that owns it. */
const LABEL_BY_TAG: ReadonlyMap<string, string> = new Map(
  GENRE_FAMILIES.flatMap((family) =>
    [...family.tags, family.label].map(
      (tag) => [tag.toLowerCase(), family.label] as const,
    ),
  ),
)

/** Labels of families the queue holds back out of its opening run. */
export const DEMOTED_LABELS: ReadonlySet<string> = new Set(
  GENRE_FAMILIES.filter((family) => family.demote).map(
    (family) => family.label,
  ),
)

/**
 * The family label owning this tag, or the tag unchanged. A tag that
 * belongs to no family is not a failure — most tags are their own
 * genre and pass straight through.
 */
export function canonicalTag(tag: string): string {
  return LABEL_BY_TAG.get(tag.trim().toLowerCase()) ?? tag
}

/**
 * Canonicalize a plain tag list: family members collapse to their
 * label, duplicates drop, family labels sort first (they are the most
 * informative thing a record says about an artist, and the panel shows
 * only the first few). Idempotent — safe to run over already-canonical
 * tags, which is what lets one call cover every pool source.
 */
export function canonicalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const canonical = tags.flatMap((tag) => {
    const label = canonicalTag(tag)
    if (seen.has(label)) return []
    seen.add(label)
    return [label]
  })
  return [
    ...canonical.filter((tag) => DEMOTED_LABELS.has(tag)),
    ...canonical.filter((tag) => !DEMOTED_LABELS.has(tag)),
  ]
}

export interface WeightedTag {
  name?: string
  count?: number
}

/**
 * Canonicalize MusicBrainz's vote-weighted tag list down to `limit`
 * display tags.
 *
 * Two rules earned the hard way on Aly Bouchnak's record, which is
 * tagged `kids`, `children`, `children's music`, `children's pop`,
 * `kids pop`, `nursery rhymes`, `lullaby`, `kindie` and `educational`:
 *
 *   - Collapse BEFORE the cut. Eight tags competing for four slots let
 *     exactly one children's tag through, and only by luck of ordering
 *     — the next such artist would have surfaced with none.
 *   - A demoted family label, once earned, always survives the cut.
 *     Everything downstream reads this list; a label truncated away is
 *     a rule that silently stops applying.
 *
 * Unvoted tags (count 0 or absent) are dropped, matching the pool's
 * existing bar: one person's unvoted `kids` on a rock band must not
 * reshape that band's queue position. Bouchnak clears it four times
 * over on votes alone.
 */
export function canonicalizeWeightedTags(
  tags: WeightedTag[],
  limit: number,
): string[] {
  const bestCount = new Map<string, number>()
  for (const tag of tags) {
    if (!tag.name || (tag.count ?? 0) <= 0) continue
    const label = canonicalTag(tag.name)
    const count = tag.count ?? 0
    bestCount.set(label, Math.max(bestCount.get(label) ?? 0, count))
  }
  // Count descending and NOTHING else. Ties keep first-appearance
  // order (Map insertion order, JS sort being stable), which is what
  // the pool did before families existed — an alphabetical tie-break
  // looked harmless and silently changed WHICH of a run of 1-vote tags
  // survived the cut for 13 unrelated Egyptian artists. This function
  // collapses families; it does not get to re-rank anyone else.
  const ranked = [...bestCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
  const demoted = ranked.filter((label) => DEMOTED_LABELS.has(label))
  const rest = ranked.filter((label) => !DEMOTED_LABELS.has(label))
  return [...demoted, ...rest].slice(0, limit)
}

/**
 * True when the artist's own tags place them in a family the queue
 * holds back. Absence of tags is not membership (standing lesson 5):
 * an untagged artist is simply unclassified and leads normally.
 */
export function isDemotedArtist(tags: string[]): boolean {
  return tags.some((tag) => DEMOTED_LABELS.has(canonicalTag(tag)))
}
