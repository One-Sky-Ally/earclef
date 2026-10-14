'use client'

import { TIER_LABELS, TIER_ORDER, type ArtistTier } from '@/lib/tiers'
import styles from './TierFilter.module.css'

/** Everything, every follow, or one of the listener's own rows. */
export type TierChoice = 'all' | 'following' | ArtistTier

interface TierFilterProps {
  /** How many artists the listener has in each of their rows. */
  counts: Record<ArtistTier, number>
  active: TierChoice
  onChange: (choice: TierChoice) => void
}

/**
 * Pills for a signed-in listener's OWN rows — never the site's or anyone
 * else's (owner ruling, Oct 14 2026). Rows with nobody in them are not
 * offered; with no follows at all there is nothing to filter by.
 */
export function TierFilter({ counts, active, onChange }: TierFilterProps) {
  const total = TIER_ORDER.reduce((sum, tier) => sum + counts[tier], 0)
  if (total === 0) return null

  const choices: TierChoice[] = [
    'all',
    'following',
    ...TIER_ORDER.filter((tier) => counts[tier] > 0),
  ]

  return (
    <div className={styles.row} role="group" aria-label="Filter by your rows">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`${styles.pill} ${choice === active ? styles.active : ''}`}
          aria-pressed={choice === active}
          onClick={() => onChange(choice)}
        >
          {choice === 'all'
            ? 'All'
            : choice === 'following'
              ? '♥ Following'
              : TIER_LABELS[choice]}
        </button>
      ))}
    </div>
  )
}
