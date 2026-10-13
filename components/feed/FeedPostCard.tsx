'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  resolveListenHref,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import { useListenService } from '@/components/listen/ServiceProvider'
import { displayTitle } from '@/lib/feed/displayTitle'
import { Icon } from '@/components/ui/Icon'
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
  presence?: ArtistServicePresence
}

interface FeedPostCardProps {
  item: FeedPostItem
  blurb?: string
  /** True while this card's blurb fetch is still in flight — shimmer. */
  blurbPending?: boolean
}

/** Blurbs longer than this get a "Read more" behind a fixed caption slot. */
const BLURB_PREVIEW_CHARS = 150

/** "Thom Yorke" → "TY": a monogram, never a borrowed photo. */
function initials(name: string): string {
  const words = name.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean)
  return (
    words
      .slice(0, 2)
      .map((word) => [...word][0] ?? '')
      .join('')
      .toUpperCase() || '♪'
  )
}

/** Where the entry's data comes from, named plainly. */
function sourceLabel(item: FeedPostItem): string {
  if (item.type === 'video') return 'Artist YouTube channel'
  const art = item.imageLarge ?? item.image
  if (art.includes('mzstatic.com')) return 'Release · Apple Music catalog'
  if (art.includes('coverartarchive.org')) return 'Release · MusicBrainz'
  return 'Release'
}

/**
 * One feed entry, in the ONE template every entry shares (UI handoff):
 * artist and type, a 16:9 preview, fixed title and caption slots with
 * "Read more", then the source and what the click does. Square cover
 * art is letterboxed over a blurred copy of itself, never cropped.
 */
export function FeedPostCard({ item, blurb, blurbPending }: FeedPostCardProps) {
  const { service } = useListenService()
  const [expanded, setExpanded] = useState(false)
  // Videos carry verified watch URLs; release links are music-service
  // searches on the fan's service, labeled as searches.
  const resolved =
    item.type === 'release'
      ? resolveListenHref(service, item.presence, item.artistName, item.title)
      : null
  // Videos carry a verified watch URL; a release is a labeled search on
  // the fan's service — or, when the artist is confirmed absent from
  // it, a note and no link at all.
  const link =
    resolved === null
      ? { href: item.href, label: 'Watch on YouTube' }
      : resolved.kind === 'search'
        ? { href: resolved.href, label: resolved.label }
        : null
  // Raw hashtags are metadata, not a headline.
  const headline = displayTitle(item.title)
  const art = item.imageLarge ?? item.image
  const long = Boolean(blurb && blurb.length > BLURB_PREVIEW_CHARS)

  const preview = (
    <>
      {item.type === 'release' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.backdrop} src={art} alt="" aria-hidden="true" loading="lazy" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={item.type === 'video' ? styles.thumb : styles.cover}
        src={art}
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
      {item.type === 'video' && (
        <span className={styles.playMark} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
      )}
    </>
  )

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(item.artistName)}
        </span>
        <span className={styles.who}>
          <Link className={styles.artist} href={`/${item.slug}`}>
            {item.artistName}
          </Link>
          <span className={styles.type}>
            {item.type === 'release' ? 'Release' : 'Video'}
          </span>
        </span>
        <span className={styles.date}>{item.dateLabel}</span>
      </header>

      {link ? (
        <a
          className={styles.media}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${link.label}: ${headline} by ${item.artistName}`}
          title={`${link.label} ↗`}
        >
          {preview}
        </a>
      ) : (
        <div className={styles.media}>{preview}</div>
      )}

      <div className={styles.body}>
        <h3 className={styles.title}>
          {link ? (
            <a href={link.href} target="_blank" rel="noreferrer">
              {headline}
            </a>
          ) : (
            headline
          )}
        </h3>
        {blurb ? (
          <>
            <p className={`${styles.blurb} ${expanded ? styles.blurbOpen : ''}`}>
              {blurb}
            </p>
            {long && (
              <button
                type="button"
                className={styles.more}
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </>
        ) : blurbPending ? (
          <span className={styles.blurbPending} aria-hidden="true" />
        ) : null}
      </div>

      <footer className={styles.foot}>
        <span className={styles.source}>{sourceLabel(item)}</span>
        {/* Says what the click does before the click: a search on a
            service, a watch on YouTube, or a confirmed absence. */}
        {link ? (
          <a className={styles.action} href={link.href} target="_blank" rel="noreferrer">
            {link.label}
            <Icon name="external" size={14} />
          </a>
        ) : (
          resolved?.kind === 'absent' && (
            <span className={styles.absent}>*{resolved.note}</span>
          )
        )}
      </footer>
    </article>
  )
}
