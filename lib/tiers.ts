/**
 * Rotation tiers — how a listener files the artists they follow. Every
 * signed-in fan keeps their OWN tiers in their fan record (lib/fans/
 * store.ts); visitors see no one's tiers (owner ruling, Oct 14 2026:
 * showing the owner's favourites to everyone was biased). The `tier`
 * field in content JSON is the owner's original curation, kept for the
 * Studio and the daily Discover prompt only.
 */

export type ArtistTier = 'heavy-rotation' | 'in-the-mix' | 'on-the-radar'

export const TIER_ORDER: ArtistTier[] = [
  'heavy-rotation',
  'in-the-mix',
  'on-the-radar',
]

export const TIER_LABELS: Record<ArtistTier, string> = {
  'heavy-rotation': 'Heavy rotation',
  'in-the-mix': 'In the mix',
  'on-the-radar': 'On the radar',
}

/** One line on what each tier means, in the listener's own terms. */
export const TIER_HINTS: Record<ArtistTier, string> = {
  'heavy-rotation': 'Your all-time favourites.',
  'in-the-mix': 'Artists you like and come back to.',
  'on-the-radar': 'Artists you’re just getting to know.',
}

/**
 * Where a follow sits until the fan places it: every follow made before
 * tiers were chosen at follow time starts here (owner, Oct 14 2026).
 */
export const DEFAULT_FOLLOW_TIER: ArtistTier = 'in-the-mix'

export function isArtistTier(value: unknown): value is ArtistTier {
  return (
    typeof value === 'string' && TIER_ORDER.includes(value as ArtistTier)
  )
}

/**
 * The tier of every followed artist: the fan's own choice when they made
 * one, else the default. Read-time, so no stored record needs migrating
 * and a follow is never lost or reset.
 */
export function followTiers(
  follows: readonly string[],
  tiers?: Record<string, unknown> | null,
): Record<string, ArtistTier> {
  const result: Record<string, ArtistTier> = {}
  for (const slug of follows) {
    const chosen = tiers?.[slug]
    result[slug] = isArtistTier(chosen) ? chosen : DEFAULT_FOLLOW_TIER
  }
  return result
}
