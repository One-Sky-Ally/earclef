'use client'

import { memo, useMemo } from 'react'
import { FollowButton } from '@/components/fans/FollowButton'
import { markPlayed, unmarkPlayed, type PlayedMark } from '@/lib/discover/played'
import { PickListenOn } from './PickListenOn'
import { PickPlayer, playableSongs } from './PickPlayer'
import styles from './PastPicks.module.css'

/** One past pick as the route sends it (lib/discover/past.ts PastPick). */
export interface PastArtist {
  pick: {
    name: string
    why: string
    mbid: string
    song: { videoId: string; title: string } | null
    /** More of the artist's own verified songs (Nov 28 2026). */
    more?: unknown
    /** The artist's own pages on music services, checked again at render. */
    services?: unknown
    bandcamp: string | null
  }
  lastDate: string
  firstDate: string
  sources: ('own' | 'shared')[]
  /** Set once the artist has an Ear Clef page: Follow follows the page. */
  slug?: string
}

const SLUG = /^[a-z0-9-]+$/

function bandcampOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    return parsed.protocol === 'https:' && (host === 'bandcamp.com' || host.endsWith('.bandcamp.com'))
      ? url
      : null
  } catch {
    return null
  }
}

export const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

function markLabel(mark: PlayedMark): string {
  return mark.how === 'hand' ? `Marked as played ${dayLabel(mark.on)}` : `Played ${dayLabel(mark.on)}`
}

/**
 * One past pick (owner, Nov 28 2026: everything a Discover card has —
 * ♥, Follow, more from the artist, "Listen on"). Memoised: a play mark
 * re-renders its own card, not the hundreds beside it.
 */
export const PastPickCard = memo(function PastPickCard({
  entry,
  mark,
}: {
  entry: PastArtist
  mark: PlayedMark | undefined
}) {
  const { pick, lastDate, firstDate, sources } = entry
  const slug = typeof entry.slug === 'string' && SLUG.test(entry.slug) ? entry.slug : undefined
  const bandcamp = bandcampOf(pick.bandcamp)
  const ownVideoId = pick.song?.videoId ?? ''
  const more = useMemo(() => playableSongs(pick.more, ownVideoId), [pick.more, ownVideoId])
  return (
    <li className={styles.card} data-played={mark ? 'true' : undefined}>
      <div className={styles.top}>
        <span className={styles.name}>{pick.name}</span>
        <span className={mark ? styles.markPlayed : styles.markNotYet}>
          {mark ? `✓ ${markLabel(mark)}` : 'Not played yet'}
        </span>
      </div>
      <span className={styles.when}>
        Recommended {dayLabel(lastDate)}
        {firstDate !== lastDate && ` (first ${dayLabel(firstDate)})`}
        {sources.includes('own') && ' · in your own picks'}
      </span>
      {pick.why && <span className={styles.why}>{pick.why}</span>}
      {pick.song && (
        <PickPlayer
          artistName={pick.name}
          mbid={pick.mbid}
          song={pick.song}
          more={more}
          onPlay={() => markPlayed(pick.mbid)}
        />
      )}
      {/* The same Follow as every artist page (Nov 28 2026). */}
      {slug ? (
        <FollowButton artistName={pick.name} slug={slug} inline />
      ) : (
        <FollowButton
          artistName={pick.name}
          mbid={pick.mbid}
          videoId={pick.song?.videoId}
          signInDest="/discover/past"
          inline
        />
      )}
      <PickListenOn artistName={pick.name} services={pick.services} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => (mark ? unmarkPlayed(pick.mbid) : markPlayed(pick.mbid, 'hand'))}
        >
          {mark ? 'Mark as not played' : 'Mark as played'}
        </button>
        {bandcamp && (
          <a className={styles.link} href={bandcamp} target="_blank" rel="noreferrer">
            Bandcamp ↗
          </a>
        )}
      </div>
    </li>
  )
})
