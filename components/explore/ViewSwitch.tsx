'use client'

import { Icon, type IconName } from '@/components/ui/Icon'
import styles from './ViewSwitch.module.css'

export type ExploreView = 'globe' | 'map' | 'list'

export const EXPLORE_VIEWS: ExploreView[] = ['globe', 'map', 'list']

const OPTIONS: { view: ExploreView; label: string; icon: IconName }[] = [
  { view: 'globe', label: '3D Globe', icon: 'globe' },
  { view: 'map', label: 'Map', icon: 'map' },
  { view: 'list', label: 'List', icon: 'list' },
]

interface ViewSwitchProps {
  view: ExploreView
  onChange: (view: ExploreView) => void
  /** 3D isn't running on this device — say so on its button. */
  globeUnavailable?: boolean
}

/** Three ways to see the same place, year and filters. */
export function ViewSwitch({ view, onChange, globeUnavailable }: ViewSwitchProps) {
  return (
    <div className={styles.switch} role="group" aria-label="Explore view">
      {OPTIONS.map((option) => (
        <button
          key={option.view}
          type="button"
          className={styles.option}
          aria-pressed={view === option.view}
          onClick={() => onChange(option.view)}
          title={
            option.view === 'globe' && globeUnavailable
              ? '3D globe unavailable on this device'
              : undefined
          }
        >
          <Icon name={option.icon} size={18} />
          <span>{option.label}</span>
          {option.view === 'globe' && globeUnavailable && (
            <span className="visually-hidden"> (unavailable on this device)</span>
          )}
        </button>
      ))}
    </div>
  )
}
