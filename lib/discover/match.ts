/**
 * A signed-in listener's Discover picks, without a model call of their
 * own (owner, Oct 15 2026): from the recent SHARED sets, the picks whose
 * `connectsTo` roster slugs are artists in the listener's rows. Joined
 * by slug only — a pick that names an artist in its prose but not in
 * `connectsTo` is not a match. Pure, so it can be tested.
 */
import type { ArtistTier } from '../tiers'
import type { DiscoverPick, DiscoverPool } from './types'

const WEIGHT: Record<ArtistTier, number> = {
  'heavy-rotation': 3,
  'in-the-mix': 2,
  'on-the-radar': 1,
}

/** How much a day of age costs a match — fresher picks lead, gently. */
const AGE_COST = 0.3

export interface RowMatch {
  pick: DiscoverPick
  /** The listener's followed slugs this pick connects to, strongest first. */
  because: string[]
}

/**
 * @param pools shared pools, NEWEST FIRST (today, yesterday, …)
 * @param tiers the listener's follows → their tier (followTiers)
 */
export function picksForRows(
  pools: readonly DiscoverPool[],
  tiers: Readonly<Record<string, ArtistTier>>,
  limit: number,
): RowMatch[] {
  const seen = new Set<string>()
  const scored: { match: RowMatch; score: number; order: number }[] = []
  let order = 0
  pools.forEach((pool, age) => {
    for (const pick of pool.picks) {
      order++
      if (seen.has(pick.mbid)) continue
      const because = (pick.connectsTo ?? [])
        .filter((slug) => tiers[slug])
        .sort((a, b) => WEIGHT[tiers[b]] - WEIGHT[tiers[a]])
      if (because.length === 0) continue
      seen.add(pick.mbid)
      const score =
        WEIGHT[tiers[because[0]]] * 2 + (because.length - 1) * 0.5 - age * AGE_COST
      scored.push({ match: { pick, because }, score, order })
    }
  })
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.match)
}
