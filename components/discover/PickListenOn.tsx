'use client'

import { useMemo } from 'react'
import { ServicePicker } from '@/components/listen/ServicePicker'
import { useListenService } from '@/components/listen/ServiceProvider'
import { sanitizeArtistLinks } from '@/lib/listen/artistLinks'
import {
  OPEN_LABELS,
  SEARCH_LABELS,
  musicServiceSearchUrl,
  searchServiceFor,
} from '@/lib/listen/services'
import styles from './PickListenOn.module.css'

/**
 * "Listen on" for a Discover pick (owner, Nov 28 2026: "Open the artist
 * on my chosen service with the same 'Listen on' picker the artist page
 * has"). The same site-wide picker as artist pages; the link opens the
 * artist's own page on that service when MusicBrainz records one, and is
 * otherwise a search for their name — labelled as a search, never as
 * the artist's page.
 */
export function PickListenOn({ artistName, services }: { artistName: string; services: unknown }) {
  const { service } = useListenService()
  const target = searchServiceFor(service)
  // Stored output outlives its code: only https artist pages survive.
  const pages = useMemo(() => sanitizeArtistLinks(services), [services])
  const page = pages[target]
  return (
    <div className={styles.row}>
      <ServicePicker />
      <a
        className={styles.link}
        href={page ?? musicServiceSearchUrl(target, artistName)}
        target="_blank"
        rel="noopener noreferrer"
        // The visible words first (voice control), then whom it is for.
        aria-label={`${page ? OPEN_LABELS[target] : SEARCH_LABELS[target]}: ${artistName} (opens in a new tab)`}
      >
        {page ? OPEN_LABELS[target] : SEARCH_LABELS[target]} ↗
      </a>
    </div>
  )
}
