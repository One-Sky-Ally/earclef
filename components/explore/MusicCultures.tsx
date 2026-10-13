'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Culture } from '@/lib/explore/cultures'
import { CultureCard } from '@/components/explore/CultureCard'
import { Icon } from '@/components/ui/Icon'
import styles from './MusicCultures.module.css'

/**
 * The "Music cultures" row: Ear Clef picks, each anchored in a place,
 * an era or a sound. Scrolls sideways by touch, trackpad, keyboard
 * (the row itself takes focus) or the arrows; "See all" opens the full
 * collection.
 */

interface MusicCulturesProps {
  cultures: Culture[]
  currentId?: string | null
  onSelect: (culture: Culture) => void
}

export function MusicCultures({ cultures, currentId, onSelect }: MusicCulturesProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    setAtStart(scroller.scrollLeft <= 4)
    setAtEnd(scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [measure])

  function page(direction: 1 | -1) {
    const scroller = scrollerRef.current
    if (!scroller) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollBy({
      left: direction * scroller.clientWidth * 0.9,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  return (
    <section className={styles.section} aria-labelledby="music-cultures-heading">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id="music-cultures-heading" className={styles.heading}>
            Music cultures
          </h2>
          <Link className={styles.seeAll} href="/cultures">
            See all
            <Icon name="chevronRight" size={16} />
          </Link>
        </div>
        <div className={styles.arrows}>
          {!atStart && (
            <button
              type="button"
              className={styles.arrow}
              onClick={() => page(-1)}
              aria-label="Previous music cultures"
            >
              <Icon name="arrowLeft" size={18} />
            </button>
          )}
          <button
            type="button"
            className={styles.arrow}
            onClick={() => page(1)}
            disabled={atEnd}
            aria-label="Next music cultures"
          >
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </div>
      <p className={styles.note}>
        Ear Clef picks — documented eras and songs about places, from what
        the site already plays.
      </p>
      <div
        ref={scrollerRef}
        className={styles.scroller}
        onScroll={measure}
        tabIndex={0}
        role="region"
        aria-label="Music cultures, scrolls sideways"
      >
        <ul className={styles.row}>
          {cultures.map((culture) => (
            <li key={culture.id} className={styles.item}>
              <CultureCard
                culture={culture}
                current={culture.id === currentId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
