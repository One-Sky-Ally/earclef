'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/Modal'
import { TierFilter, type TierChoice } from '@/components/TierFilter'
import { useListenService } from '@/components/listen/ServiceProvider'
import { Icon } from '@/components/ui/Icon'
import { displayTitle } from '@/lib/feed/displayTitle'
import {
  resolveListenHref,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import type { ReleaseLinks } from '@/lib/listen/releaseLinks'
import {
  TIER_LABELS,
  TIER_ORDER,
  inTierChoice,
  type ArtistTier,
} from '@/lib/tiers'
import styles from './ReleasesPopup.module.css'

export interface ReleaseRow {
  slug: string
  artistName: string
  title: string
  /** "Coming Dec 12, 2026" / "Nov 14, 2026" — already worded. */
  dateLabel: string
  image: string
  presence?: ArtistServicePresence
  /** The release itself on the services the feed confirmed it on. */
  links?: ReleaseLinks
  /** "November 2026" — the month heading the row files under. */
  monthLabel?: string
}

/** A signed-in listener's own rows, for the pop-up's filter pills. */
export interface RowsFilter {
  follows: string[]
  tiers: Record<string, ArtistTier>
  /** How many followed artists sit in each row (empty rows get no pill). */
  counts: Record<ArtistTier, number>
  /** The Feed's filter when the pop-up opened: where the pop-up starts. */
  initial: TierChoice
}

interface ReleasesPopupProps {
  kind: 'coming' | 'recent'
  rows: ReleaseRow[]
  /** Recently released only: filter by the listener's rows. */
  filter?: RowsFilter
  onClose: () => void
}

// A year of releases can run to hundreds of rows: draw them a page at a
// time so the pop-up opens instantly, even on a phone.
const PAGE_SIZE = 40

const COPY = {
  coming: {
    title: 'Coming soon',
    subtitle:
      'Announced releases from the roster, soonest first. Each opens the release on your service ↗ where we could confirm it there, otherwise a search.',
  },
  recent: {
    title: 'Recently released',
    subtitle:
      'Releases from the roster in the past year, newest first. Each opens the release on your service ↗ where we could confirm it there, otherwise a search.',
  },
} as const

/**
 * The Feed's release lists, opened from a link instead of sitting on the
 * page (owner, Nov 18 2026). Both lists follow the listener's chosen
 * service, like the feed's release cards (owner, Nov 22 2026: "Coming soon"
 * used to always open Apple Music).
 */
export function ReleasesPopup({
  kind,
  rows,
  filter,
  onClose,
}: ReleasesPopupProps) {
  const { service } = useListenService()
  const copy = COPY[kind]
  const [choice, setChoice] = useState<TierChoice>(filter?.initial ?? 'all')
  const [shown, setShown] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLUListElement>(null)

  const followSet = useMemo(() => new Set(filter?.follows ?? []), [filter])
  const chosen = useMemo(
    () =>
      filter
        ? rows.filter((row) =>
            inTierChoice(row.slug, choice, followSet, filter.tiers),
          )
        : rows,
    [rows, filter, choice, followSet],
  )
  const hasPills =
    !!filter && TIER_ORDER.some((tier) => filter.counts[tier] > 0)
  const remaining = chosen.length - Math.min(shown, chosen.length)

  function pick(next: TierChoice) {
    setChoice(next)
    setShown(PAGE_SIZE)
    listRef.current?.scrollTo({ top: 0 })
  }

  const countLine =
    choice === 'all'
      ? `${chosen.length} ${chosen.length === 1 ? 'release' : 'releases'}`
      : `${chosen.length} from ${
          choice === 'following'
            ? 'the artists you follow'
            : `your ${TIER_LABELS[choice]} artists`
        }`

  function listenFor(row: ReleaseRow) {
    const resolved = resolveListenHref(
      service,
      row.presence,
      row.artistName,
      row.title,
      row.links,
    )
    return resolved.kind !== 'absent'
      ? { href: resolved.href, label: resolved.label }
      : { note: resolved.note }
  }

  return (
    <Modal title={copy.title} subtitle={copy.subtitle} onClose={onClose}>
      {hasPills && filter && (
        <div className={styles.filters}>
          <TierFilter counts={filter.counts} active={choice} onChange={pick} />
          <p className={styles.count} aria-live="polite">
            {countLine}
          </p>
        </div>
      )}
      {chosen.length === 0 && (
        <p className={styles.empty}>
          Nothing released in the past year from{' '}
          {choice === 'following'
            ? 'the artists you follow'
            : choice === 'all'
              ? 'the roster'
              : `your ${TIER_LABELS[choice]} artists`}
          .
        </p>
      )}
      <ul className={styles.list} ref={listRef}>
        {chosen.slice(0, shown).map((row, index, page) => {
          const listen = listenFor(row)
          const headline = displayTitle(row.title)
          const newMonth =
            row.monthLabel && row.monthLabel !== page[index - 1]?.monthLabel
          return (
            <Fragment
              key={`${row.slug}-${row.title}-${row.dateLabel}-${index}`}
            >
              {newMonth && (
                <li className={styles.monthRow}>
                  <h3 className={styles.month}>{row.monthLabel}</h3>
                </li>
              )}
              <li className={styles.row}>
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
            </Fragment>
          )
        })}
        {remaining > 0 && (
          <li className={styles.moreRow}>
            <button
              type="button"
              className={styles.more}
              onClick={() => setShown((count) => count + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, remaining)} more ↓
            </button>
          </li>
        )}
      </ul>
    </Modal>
  )
}
