'use client'

import { useListenService } from '@/components/listen/ServiceProvider'
import {
  SERVICE_LABELS,
  absenceFor,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import styles from './ServiceAbsenceNote.module.css'

/**
 * The graceful "not on your service" line — shown only when the owner
 * has asserted the absence, wording the owner wrote, routing to where
 * the artist actually is.
 */
export function ServiceAbsenceNote({
  presence,
}: {
  presence: ArtistServicePresence
}) {
  const { service } = useListenService()
  const absence = absenceFor(service, presence)
  if (!absence) return null

  const note =
    absence.note ??
    `Not on ${SERVICE_LABELS[service]} — the artist's choice.`
  const target =
    service !== 'appleMusic' && presence.appleMusicUrl
      ? { href: presence.appleMusicUrl, label: 'Listen on Apple Music →' }
      : {
          href: `https://www.youtube.com/results?search_query=${encodeURIComponent(presence.artistName)}`,
          label: 'Find them on YouTube →',
        }

  return (
    <p className={styles.note}>
      {note}{' '}
      <a
        className={styles.link}
        href={target.href}
        target="_blank"
        rel="noreferrer"
      >
        {target.label}
      </a>
    </p>
  )
}
