/**
 * Curation tiers — the owner's personal rotation levels, stored per artist
 * in content JSON for now. Components only ever consume a slug→tier map, so
 * when accounts exist the map can come from a per-user store instead without
 * touching any UI.
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

export function isArtistTier(value: unknown): value is ArtistTier {
  return (
    typeof value === 'string' && TIER_ORDER.includes(value as ArtistTier)
  )
}
