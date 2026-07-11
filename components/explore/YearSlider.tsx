'use client'

import type { CSSProperties } from 'react'
import styles from './YearSlider.module.css'

interface YearSliderProps {
  year: number
  min: number
  max: number
  onChange: (year: number) => void
}

export function YearSlider({ year, min, max, onChange }: YearSliderProps) {
  const fill = `${((year - min) / (max - min)) * 100}%`

  return (
    <div className={styles.wrapper}>
      <output className={styles.readout} htmlFor="year-slider">
        {year}
      </output>
      <input
        id="year-slider"
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={1}
        value={year}
        aria-label="Year"
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--fill': fill } as CSSProperties}
      />
      <div className={styles.bounds} aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
