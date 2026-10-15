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

/** Wall clock for the throttle — read only from event handlers. */
const clock = () => Date.now()

/**
 * The thin decade slider from the preferred Explore design: one line,
 * a dot per decade, a circular handle. The decade marks are landmarks
 * only — every single year from `min` to `max` stays selectable, by
 * drag, arrow keys, or the year field beside it.
 */
export function YearSlider({ year, min, max, onChange }: YearSliderProps) {
  const [localYear, setLocalYear] = useState(year)
  const [draft, setDraft] = useState<string | null>(null)
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
    const sinceSend = clock() - lastSentAt.current
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
    lastSentAt.current = clock()
    lastSentValue.current = value
    onChange(value)
  }

  function handleInput(value: number) {
    setLocalYear(value)
    const elapsed = clock() - lastSentAt.current
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

  /** A precise year, typed: lands at once, or reverts if out of range. */
  function commitDraft() {
    if (draft === null) return
    const value = Number(draft)
    setDraft(null)
    if (!Number.isInteger(value) || value < min || value > max) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    pending.current = null
    setLocalYear(value)
    send(value)
  }

  function jumpTo(value: number) {
    const clamped = Math.min(max, Math.max(min, value))
    setLocalYear(clamped)
    send(clamped)
  }

  const span = max - min
  const position = (value: number) => `${((value - min) / span) * 100}%`
  const decades: number[] = []
  for (let decade = Math.ceil(min / 10) * 10; decade <= max; decade += 10) {
    decades.push(decade)
  }
  const activeDecade = Math.floor(localYear / 10) * 10
  const fill = { '--fill': position(localYear) } as CSSProperties

  return (
    <div className={styles.wrapper}>
      <label className={styles.yearField}>
        <span className={styles.yearLabel}>Year</span>
        <input
          className={styles.yearInput}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? String(localYear)}
          aria-label={`Year, ${min} to ${max}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitDraft()
            } else if (event.key === 'Escape') {
              setDraft(null)
            }
          }}
        />
      </label>
      <div className={styles.rail}>
        <div className={styles.track} style={fill}>
          <div className={styles.line} aria-hidden="true" />
          <div className={styles.ticks} aria-hidden="true">
            {decades.map((decade) => (
              <span
                key={decade}
                className={`${styles.tick} ${decade === activeDecade ? styles.tickActive : ''}`}
                style={{ left: position(decade) }}
              />
            ))}
          </div>
          <input
            className={styles.range}
            type="range"
            min={min}
            max={max}
            step={1}
            value={localYear}
            aria-label="Year"
            aria-valuetext={`${localYear}`}
            onChange={(event) => handleInput(Number(event.target.value))}
            onPointerUp={commit}
            onTouchEnd={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
        </div>
        <div className={styles.labels}>
          {decades.map((decade, index) => (
            <button
              key={decade}
              type="button"
              tabIndex={-1}
              className={`${styles.label} ${index % 2 === 1 ? styles.labelMinor : ''} ${decade === activeDecade ? styles.labelActive : ''}`}
              style={{ left: position(decade) }}
              onClick={() => jumpTo(decade)}
              aria-label={`Jump to ${decade}`}
            >
              {decade}s
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
