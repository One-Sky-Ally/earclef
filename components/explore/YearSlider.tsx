'use client'

import type { CSSProperties } from 'react'
import styles from './YearSlider.module.css'

interface YearSliderProps {
  year: number
  min: number
  max: number
  onChange: (year: number) => void
}

/**
 * One thumb, one year. The two-thumb range (July 2026) read as "a
 * number that's secretly a range" to first-time visitors and wide
 * spans made the heaviest queries — sparse year+place results now
 * widen from inside the panel instead ("show nearby years").
 */
export function YearSlider({ year, min, max, onChange }: YearSliderProps) {
  const pct = ((year - min) / (max - min)) * 100
  const fillVars = {
    '--fill-start': '0%',
    '--fill-end': `${pct}%`,
  } as CSSProperties

  return (
    <div className={styles.wrapper}>
      <output className={styles.readout}>{year}</output>
      <div className={styles.track} style={fillVars}>
        <input
          className={styles.range}
          type="range"
          min={min}
          max={max}
          step={1}
          value={year}
          aria-label="Year"
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <div className={styles.bounds} aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
