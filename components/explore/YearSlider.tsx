'use client'

import type { CSSProperties } from 'react'
import styles from './YearSlider.module.css'

interface YearSliderProps {
  start: number
  end: number
  min: number
  max: number
  onChange: (start: number, end: number) => void
}

/**
 * A two-thumb year slider: thumbs together = a single year (the classic
 * behavior), pull them apart to aggregate a span. A thumb dragged past
 * its partner pushes it along, so the range can never invert.
 */
export function YearSlider({ start, end, min, max, onChange }: YearSliderProps) {
  const pct = (year: number) => ((year - min) / (max - min)) * 100
  const fillVars = {
    '--fill-start': `${pct(start)}%`,
    '--fill-end': `${pct(end)}%`,
  } as CSSProperties

  return (
    <div className={styles.wrapper}>
      <output className={styles.readout}>
        {start === end ? start : `${start}–${end}`}
      </output>
      <div className={styles.track} style={fillVars}>
        <input
          className={styles.range}
          type="range"
          min={min}
          max={max}
          step={1}
          value={start}
          aria-label="From year"
          onChange={(event) => {
            const value = Number(event.target.value)
            onChange(Math.min(value, end), Math.max(value, end))
          }}
        />
        <input
          className={styles.range}
          type="range"
          min={min}
          max={max}
          step={1}
          value={end}
          aria-label="To year"
          onChange={(event) => {
            const value = Number(event.target.value)
            onChange(Math.min(value, start), Math.max(value, start))
          }}
        />
      </div>
      <div className={styles.bounds} aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
