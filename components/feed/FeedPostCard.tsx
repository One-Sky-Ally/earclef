'use client'

import Link from 'next/link'
import styles from './FeedPostCard.module.css'

export interface FeedPostItem {
  type: 'release' | 'video'
  slug: string
  artistName: string
  title: string
  dateLabel: string
  image: string
  imageLarge?: string
  href: string
}

interface FeedPostCardProps {
  item: FeedPostItem
  blurb?: string
  /** True while this card's blurb fetch is still in flight — shimmer. */
  blurbPending?: boolean
}

/**
 * A featured feed entry, shaped like a post: big art (a functional link
 * to the source, same hotlink pattern as the artist cards), title, and
 * an original Ear Clef blurb that pops in once generated.
 */
export function FeedPostCard({ item, blurb, blurbPending }: FeedPostCardProps) {
  return (
    <article className={styles.card}>
      <a
        className={styles.media}
        href={item.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${item.title} at the source`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={item.type === 'video' ? styles.thumb : styles.cover}
          src={item.imageLarge ?? item.image}
          alt=""
          loading="lazy"
          onError={(event) => {
            const img = event.currentTarget
            // maxresdefault (and some covers) 404 — step down, then out.
            if (img.src !== item.image && item.image.startsWith('http')) {
              img.src = item.image
            } else {
              img.src = '/images/hero-placeholder.svg'
            }
          }}
        />
      </a>
      <div className={styles.body}>
        <p className={styles.meta}>
          <span className={styles.badge}>
            {item.type === 'release' ? 'Release' : 'Video'}
          </span>
          <Link className={styles.artist} href={`/${item.slug}`}>
            {item.artistName}
          </Link>
          <span className={styles.date}>{item.dateLabel}</span>
        </p>
        <a
          className={styles.title}
          href={item.href}
          target="_blank"
          rel="noreferrer"
        >
          {item.title}
        </a>
        {blurb ? (
          <p className={styles.blurb}>{blurb}</p>
        ) : (
          blurbPending && (
            <span className={styles.blurbPending} aria-hidden="true" />
          )
        )}
      </div>
    </article>
  )
}
