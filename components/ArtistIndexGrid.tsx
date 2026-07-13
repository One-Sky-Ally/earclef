'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ArtistTier } from '@/lib/tiers'
import { TierFilter, type TierChoice } from '@/components/TierFilter'
import styles from '@/app/artists/artists.module.css'

export interface ArtistCardData {
  slug: string
  name: string
  identity: string
  location: string
  /** First-video thumbnail (i.ytimg.com) — null falls back to placeholder. */
  thumbUrl: string | null
  tier?: ArtistTier
}

export function ArtistIndexGrid({ cards }: { cards: ArtistCardData[] }) {
  const [choice, setChoice] = useState<TierChoice>('all')

  const available = [
    ...new Set(cards.flatMap((card) => (card.tier ? [card.tier] : []))),
  ]
  const visible =
    choice === 'all' ? cards : cards.filter((card) => card.tier === choice)

  return (
    <>
      <TierFilter available={available} active={choice} onChange={setChoice} />
      <ul className={styles.grid}>
        {visible.map((card, index) => (
          <li key={card.slug}>
            <Link className={styles.card} href={`/${card.slug}`}>
              <span
                className={`${styles.visual} ${card.thumbUrl ? styles.duotone : ''}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={card.thumbUrl ? styles.thumb : styles.placeholder}
                  src={card.thumbUrl ?? '/images/hero-placeholder.svg'}
                  alt=""
                  loading="lazy"
                />
              </span>
              <span className={styles.cardBody}>
                <span className={styles.index} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={styles.name}>{card.name}</span>
                <span className={styles.identity}>{card.identity}</span>
                <span className={styles.location}>{card.location}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
