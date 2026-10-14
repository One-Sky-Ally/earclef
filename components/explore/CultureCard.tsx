'use client'

import Link from 'next/link'
import {
  eraSpan,
  genreList,
  type Culture,
} from '@/lib/explore/cultureTypes'
import { Icon } from '@/components/ui/Icon'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './CultureCard.module.css'

/**
 * One music culture — a place, an era, a sound — as a card. The picture
 * is the still of a song in it that already plays on the site; a
 * culture with none gets a quiet typographic plate, never a stock photo.
 */

interface CultureCardProps {
  culture: Culture
  /** In-page: feature this culture in the journey panel. */
  onSelect?: (culture: Culture) => void
  /** Elsewhere: open it on Explore. */
  href?: string
  /** Marks the culture already featured in the panel. */
  current?: boolean
}

export function cultureLines(culture: Culture): { title: string; meta: string } {
  if (culture.kind === 'era') {
    return { title: culture.title, meta: `${culture.place} · ${eraSpan(culture)}` }
  }
  if (culture.kind === 'decade') {
    const genres = culture.genres?.slice(0, 2) ?? []
    return {
      title: culture.title,
      meta: `${culture.count} songs${genres.length > 0 ? ` · ${genreList(genres)}` : ''}`,
    }
  }
  const span =
    culture.firstYear && culture.lastYear && culture.firstYear !== culture.lastYear
      ? ` · ${culture.firstYear}–${culture.lastYear}`
      : ''
  return {
    title: `Songs about ${culture.place}`,
    meta: `${culture.count} song${culture.count === 1 ? '' : 's'}${span}`,
  }
}

export function CultureCard({ culture, onSelect, href, current }: CultureCardProps) {
  const { title, meta } = cultureLines(culture)
  const body = (
    <>
      <span className={styles.art} aria-hidden="true">
        {culture.thumb ? (
          <SafeImage
            className={styles.image}
            src={`https://i.ytimg.com/vi/${culture.thumb}/hqdefault.jpg`}
          />
        ) : null}
        <span className={styles.plateText}>{culture.place}</span>
      </span>
      <span className={styles.shade} aria-hidden="true" />
      <span className={styles.text}>
        <span className={styles.kind}>
          {culture.kind === 'era'
            ? 'Documented era'
            : culture.kind === 'decade'
              ? 'Decade journey'
              : 'Songs about a place'}
        </span>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>{meta}</span>
      </span>
      <span className={styles.go} aria-hidden="true">
        <Icon name="arrowRight" size={18} />
      </span>
    </>
  )
  const className = `${styles.card} ${current ? styles.current : ''}`
  if (href) {
    return (
      <Link className={className} href={href}>
        {body}
      </Link>
    )
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => onSelect?.(culture)}
      aria-current={current ? 'true' : undefined}
    >
      {body}
    </button>
  )
}
