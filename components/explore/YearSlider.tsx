'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import styles from './YearSlider.module.css'

interface YearSliderProps {
  year: number
  min: number
  max: number
  onChange: (year: number) => void
}

/**
 * Dragging must stay CHEAP (mobile crash report, Aug 2026): the thumb
 * and readout track every tick locally, but the app only hears a
 * throttled stream (~6/s) plus a guaranteed commit on release. A fast
 * drag used to fire heat recomputes, panel remounts, and — fatally —
 * a history.replaceState per tick, which iOS Safari rate-limits by
 * THROWING after ~100 calls/30s.
 */
const COMMIT_THROTTLE_MS = 160

export function YearSlider({ year, min, max, onChange }: YearSliderProps) {
  const [localYear, setLocalYear] = useState(year)
  const lastSentAt = useRef(0)
  const lastSentValue = useRef(year)
  const pending = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // External year changes (surprise tween, deep links) move the thumb.
  // Echoes of our own throttled commits must not yank it — and React
  // can deliver an EARLIER send's echo after a later one (stale prop
  // vs advanced ref), so "differs from last sent" alone misfires. Any
  // prop change landing hot on the heels of a send is treated as an
  // echo; genuinely external changes never race a live drag.
  useEffect(() => {
    const sinceSend = Date.now() - lastSentAt.current
    if (year !== lastSentValue.current && sinceSend > 600) {
      lastSentValue.current = year
      setLocalYear(year)
    }
  }, [year])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function send(value: number) {
    lastSentAt.current = Date.now()
    lastSentValue.current = value
    onChange(value)
  }

  function handleInput(value: number) {
    setLocalYear(value)
    const elapsed = Date.now() - lastSentAt.current
    if (elapsed >= COMMIT_THROTTLE_MS) {
      send(value)
      return
    }
    pending.current = value
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null
        if (pending.current !== null) {
          send(pending.current)
          pending.current = null
        }
      }, COMMIT_THROTTLE_MS - elapsed)
    }
  }

  /** Release/keyboard settle: the final value always lands. */
  function commit() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current !== null) {
      send(pending.current)
      pending.current = null
    }
  }

  const pct = ((localYear - min) / (max - min)) * 100
  const fillVars = {
    '--fill-start': '0%',
    '--fill-end': `${pct}%`,
  } as CSSProperties

  return (
    <div className={styles.wrapper}>
      <output className={styles.readout}>{localYear}</output>
      <div className={styles.track} style={fillVars}>
        <input
          className={styles.range}
          type="range"
          min={min}
          max={max}
          step={1}
          value={localYear}
          aria-label="Year"
          onChange={(event) => handleInput(Number(event.target.value))}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
      <div className={styles.bounds} aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
