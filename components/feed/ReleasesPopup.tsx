'use client'

import Link from 'next/link'
import { Modal } from '@/components/Modal'
import { useListenService } from '@/components/listen/ServiceProvider'
import { Icon } from '@/components/ui/Icon'
import { displayTitle } from '@/lib/feed/displayTitle'
import {
  resolveListenHref,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import styles from './ReleasesPopup.module.css'

export interface ReleaseRow {
  slug: string
  artistName: string
  title: string
  /** "Coming Dec 12, 2026" / "Nov 14, 2026" — already worded. */
  dateLabel: string
  image: string
  presence?: ArtistServicePresence
}

interface ReleasesPopupProps {
  kind: 'coming' | 'recent'
  rows: ReleaseRow[]
  onClose: () => void
}

const COPY = {
  coming: {
    title: 'Coming soon',
    subtitle:
      'Announced releases from the roster, soonest first. Each opens a search on your service ↗, not a guaranteed match.',
  },
  recent: {
    title: 'Recently released',
    subtitle:
      'Releases from the roster in the last 30 days, newest first. Each opens a search on your service ↗, not a guaranteed match.',
  },
} as const

/**
 * The Feed's release lists, opened from a link instead of sitting on the
 * page (owner, Nov 18 2026). Both lists follow the listener's chosen
 * service, like the feed's release cards (owner, Nov 22 2026: "Coming soon"
 * used to always open Apple Music).
 */
export function ReleasesPopup({ kind, rows, onClose }: ReleasesPopupProps) {
  const { service } = useListenService()
  const copy = COPY[kind]

  function listenFor(row: ReleaseRow) {
    const resolved = resolveListenHref(
      service,
      row.presence,
      row.artistName,
      row.title,
    )
    return resolved.kind === 'search'
      ? { href: resolved.href, label: resolved.label }
      : { note: resolved.note }
  }

  return (
    <Modal title={copy.title} subtitle={copy.subtitle} onClose={onClose}>
      <ul className={styles.list}>
        {rows.map((row) => {
          const listen = listenFor(row)
          const headline = displayTitle(row.title)
          return (
            <li key={`${row.slug}-${row.title}`} className={styles.row}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.cover}
                src={row.image}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.src = '/images/hero-placeholder.svg'
                }}
              />
              <div className={styles.body}>
                <span className={styles.date}>{row.dateLabel}</span>
                <span className={styles.title}>{headline}</span>
                <Link className={styles.artist} href={`/${row.slug}`}>
                  {row.artistName}
                </Link>
              </div>
              {'href' in listen ? (
                <a
                  className={styles.action}
                  href={listen.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${listen.label}: ${headline} by ${row.artistName}`}
                >
                  {listen.label}
                  <Icon name="external" size={14} />
                </a>
              ) : (
                <span className={styles.absent}>*{listen.note}</span>
              )}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
