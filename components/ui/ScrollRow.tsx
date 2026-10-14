'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import styles from './ScrollRow.module.css'

interface ScrollRowProps {
  /** Heading id, for the section's accessible name. */
  id: string
  title: string
  /** One plain line under the heading. */
  note?: React.ReactNode
  /** A small "See all" link above the LEFT of the cards (handoff). */
  seeAll?: { href: string; label?: string }
  /** Cards visible at once on a wide screen. */
  perView?: 2 | 3 | 4 | 5
  /** Each child is one card; it is wrapped in a list item here. */
  items: { key: string; node: React.ReactNode }[]
  /** Heading level — h2 by default. */
  level?: 2 | 3
}

/**
 * A row of cards that scrolls sideways — touch, trackpad, keyboard (the
 * row takes focus; arrow keys scroll it) or the arrow buttons. A
 * previous arrow appears once the row has moved; the next arrow sits
 * at the right edge and stops at the end.
 */
export function ScrollRow({
  id,
  title,
  note,
  seeAll,
  perView = 3,
  items,
  level = 2,
}: ScrollRowProps) {
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
  }, [measure, items.length])

  function page(direction: 1 | -1) {
    const scroller = scrollerRef.current
    if (!scroller) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollBy({
      left: direction * scroller.clientWidth * 0.9,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  const Heading = level === 2 ? 'h2' : 'h3'
  const headingId = `${id}-heading`

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <Heading id={headingId} className={level === 2 ? styles.heading : styles.headingSmall}>
            {title}
          </Heading>
          {seeAll && (
            <Link className={styles.seeAll} href={seeAll.href}>
              {seeAll.label ?? 'See all'}
              <Icon name="chevronRight" size={16} />
            </Link>
          )}
        </div>
        {!(atStart && atEnd) && (
          <div className={styles.arrows}>
            {!atStart && (
              <button
                type="button"
                className={styles.arrow}
                onClick={() => page(-1)}
                aria-label={`Previous in ${title}`}
              >
                <Icon name="arrowLeft" size={18} />
              </button>
            )}
            <button
              type="button"
              className={styles.arrow}
              onClick={() => page(1)}
              disabled={atEnd}
              aria-label={`Next in ${title}`}
            >
              <Icon name="arrowRight" size={18} />
            </button>
          </div>
        )}
      </div>
      {note && <p className={styles.note}>{note}</p>}
      <div
        ref={scrollerRef}
        className={styles.scroller}
        onScroll={measure}
        tabIndex={0}
        role="region"
        aria-label={`${title}, scrolls sideways`}
      >
        <ul className={`${styles.row} ${styles[`per${perView}`]}`}>
          {items.map((item) => (
            <li key={item.key} className={styles.item}>
              {item.node}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
