'use client'

import { TIER_LABELS, TIER_ORDER, type ArtistTier } from '@/lib/tiers'
import styles from './TierFilter.module.css'

export type TierChoice = ArtistTier | 'all'

interface TierFilterProps {
  /** Tiers actually present in the data — pills for absent tiers are hidden. */
  available: ArtistTier[]
  active: TierChoice
  onChange: (choice: TierChoice) => void
}

/** Subtle pill row for the owner's curation tiers. Hidden until tiers exist. */
export function TierFilter({ available, active, onChange }: TierFilterProps) {
  if (available.length === 0) return null

  const choices: TierChoice[] = [
    'all',
    ...TIER_ORDER.filter((tier) => available.includes(tier)),
  ]

  return (
    <div className={styles.row} role="group" aria-label="Filter by tier">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`${styles.pill} ${choice === active ? styles.active : ''}`}
          aria-pressed={choice === active}
          onClick={() => onChange(choice)}
        >
          {choice === 'all' ? 'All' : TIER_LABELS[choice]}
        </button>
      ))}
    </div>
  )
}
