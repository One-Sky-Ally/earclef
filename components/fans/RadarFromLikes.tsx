'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { RadarArtist } from '@/lib/fans/radar'
import { useLikes } from '@/components/fans/LikesProvider'
import styles from './RadarFromLikes.module.css'

interface RadarFromLikesProps {
  artists: RadarArtist[]
  /** Saved songs whose artist carries no MusicBrainz id. */
  withoutIdentity: number
  /** Dismissed artists still behind saved songs — restorable. */
  dismissedMbids: string[]
  /** Follows the artist and moves them into the map proper. */
  onFollow: (slug: string) => Promise<void>
}

/**
 * The part of "On the radar" that the listener never assigned: artists
 * their saved songs put there. Rostered ones can be followed in a tap,
 * which moves them out of here and into the map proper; anyone can be
 * dismissed, which is the only radar state that is ever stored.
 */
export function RadarFromLikes({
  artists,
  withoutIdentity,
  dismissedMbids,
  onFollow,
}: RadarFromLikesProps) {
  const { setRadarDismissed } = useLikes()
  const [busy, setBusy] = useState<string | null>(null)

  if (
    artists.length === 0 &&
    withoutIdentity === 0 &&
    dismissedMbids.length === 0
  ) {
    return null
  }

  async function follow(slug: string) {
    setBusy(slug)
    try {
      await onFollow(slug)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.block}>
      {artists.length > 0 && (
        <>
          <p className={styles.lead}>
            From your saved songs — not followed yet.
          </p>
          <ul className={styles.rows}>
            {artists.map((artist) => (
              <li key={artist.mbid} className={styles.row}>
                <div className={styles.rowText}>
                  {artist.slug ? (
                    <Link
                      className={styles.artist}
                      href={`/${artist.slug}`}
                    >
                      {artist.name}
                    </Link>
                  ) : (
                    <span className={styles.artistPlain}>{artist.name}</span>
                  )}
                  <span className={styles.meta}>
                    {artist.songs} saved song
                    {artist.songs === 1 ? '' : 's'}
                    {!artist.slug && ' · no Ear Clef page yet'}
                  </span>
                </div>
                <div className={styles.actions}>
                  {artist.slug && (
                    <button
                      type="button"
                      className={styles.follow}
                      onClick={() => follow(artist.slug as string)}
                      disabled={busy === artist.slug}
                    >
                      {busy === artist.slug ? '…' : '♡ Follow'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.dismiss}
                    onClick={() => setRadarDismissed(artist.mbid, true)}
                    aria-label={`Take ${artist.name} off the radar`}
                    title="Take off the radar — your saved songs stay"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* A dismissal must have a way back — otherwise one tap silently
          and permanently hides an artist the listener still has songs
          by. Only artists who would actually reappear are offered. */}
      {dismissedMbids.length > 0 && (
        <p className={styles.note}>
          {dismissedMbids.length} artist
          {dismissedMbids.length === 1 ? '' : 's'} hidden from your radar.{' '}
          <button
            type="button"
            className={styles.restore}
            onClick={() => {
              for (const mbid of dismissedMbids) {
                setRadarDismissed(mbid, false)
              }
            }}
          >
            Show {dismissedMbids.length === 1 ? 'them' : 'them all'} again
          </button>
        </p>
      )}

      {/* Said plainly rather than left as a puzzle: a listener who saved
          six #1s and sees nobody appear deserves the reason. */}
      {withoutIdentity > 0 && (
        <p className={styles.note}>
          {withoutIdentity} saved song{withoutIdentity === 1 ? '' : 's'}
          {' came from a chart queue, which carries no artist id — a name '}
          alone isn&rsquo;t enough to put someone here.
        </p>
      )}
    </div>
  )
}
