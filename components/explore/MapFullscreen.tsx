'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { YEAR_MAX, YEAR_MIN } from '@/lib/explore/counts'
import { FlatMap } from '@/components/explore/FlatMap'
import { YearSlider } from '@/components/explore/YearSlider'
import type { SelectedCountry } from '@/components/explore/CountryPanel'
import { Icon } from '@/components/ui/Icon'
import styles from './MapFullscreen.module.css'

interface MapFullscreenProps {
  year: number
  onYearChange: (year: number) => void
  selected: SelectedCountry | null
  highlight?: SelectedCountry | null
  /** A country was picked: the page opens it (and this closes). */
  onCountryClick: (country: SelectedCountry) => void
  onClose: () => void
}

/**
 * The Map view, full screen: the whole world as big as the screen,
 * zoom and pan, the year line along the bottom. Picking a country
 * closes it and opens that country's panel on the page. Esc closes;
 * focus stays inside while it is open and returns where it came from.
 */
export function MapFullscreen({
  year,
  onYearChange,
  selected,
  highlight,
  onCountryClick,
  onClose,
}: MapFullscreenProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // The page re-renders while this is open (the year moves); the setup
  // below must run once, so it reads the latest onClose through a ref.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      // Keep Tab inside the dialog.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, a[href]',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      returnTo?.focus?.()
    }
  }, [])

  return createPortal(
    <div
      ref={dialogRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-fullscreen-title"
    >
      <div className={styles.head}>
        <div>
          <h2 id="map-fullscreen-title" className={styles.title}>
            World map · {year}
          </h2>
          <p className={styles.hint}>
            Scroll or pinch to zoom · drag to move · pick a country to open it
          </p>
        </div>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
          <Icon name="close" size={18} />
          Close
        </button>
      </div>
      <div className={styles.map}>
        <FlatMap
          interactive
          year={year}
          selected={selected}
          highlight={highlight}
          onCountryClick={(country) => {
            onCountryClick(country)
            onClose()
          }}
        />
      </div>
      <div className={styles.time}>
        <YearSlider year={year} min={YEAR_MIN} max={YEAR_MAX} onChange={onYearChange} />
      </div>
    </div>,
    document.body,
  )
}
