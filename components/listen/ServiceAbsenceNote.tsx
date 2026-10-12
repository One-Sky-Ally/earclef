'use client'

import { useListenService } from '@/components/listen/ServiceProvider'
import {
  SERVICE_LABELS,
  absenceFor,
  absenceNote,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import styles from './ServiceAbsenceNote.module.css'

/**
 * The graceful "not on your service" line — shown only when the
 * absence is CONFIRMED (the owner asserted it, or the verifier checked
 * the service itself), and pointing at a page the artist verifiably
 * has: their Bandcamp, or a stored artist page on another service.
 * Never a YouTube search (banned site-wide) and never a guess.
 */
export function ServiceAbsenceNote({
  presence,
}: {
  presence: ArtistServicePresence
}) {
  const { service } = useListenService()
  const absence = absenceFor(service, presence)
  if (!absence) return null

  const note = absenceNote(absence)
  const target = presence.bandcampUrl
    ? { href: presence.bandcampUrl, label: 'Their Bandcamp ↗' }
    : service !== 'appleMusic' && presence.appleMusicUrl
      ? { href: presence.appleMusicUrl, label: `On ${SERVICE_LABELS.appleMusic} ↗` }
      : service !== 'amazonMusic' && presence.amazonMusicUrl
        ? { href: presence.amazonMusicUrl, label: `On ${SERVICE_LABELS.amazonMusic} ↗` }
        : service !== 'spotify' && presence.spotifyUrl
          ? { href: presence.spotifyUrl, label: `On ${SERVICE_LABELS.spotify} ↗` }
          : null

  return (
    <p className={styles.note}>
      *{note}
      {absence.source === 'verified' && (
        <span className={styles.verified}> (checked against the service)</span>
      )}
      {target && (
        <>
          {' '}
          <a
            className={styles.link}
            href={target.href}
            target="_blank"
            rel="noreferrer"
          >
            {target.label}
          </a>
        </>
      )}
    </p>
  )
}
