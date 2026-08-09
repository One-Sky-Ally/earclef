'use client'

import { useEffect, useState } from 'react'
import {
  fetchArtistEra,
  musicBrainzArtistUrl,
  type ArtistEraDetails,
} from '@/lib/explore/panelData'
import { YEAR_MAX, YEAR_MIN } from '@/lib/explore/counts'
import { resolveListenHref } from '@/lib/listen/services'
import { useListenService } from '@/components/listen/ServiceProvider'
import styles from './CountryPanel.module.css'
import eraStyles from './ArtistEraPanel.module.css'

export interface SelectedArtist {
  mbid: string
  name: string
}

interface ArtistEraPanelProps {
  artist: SelectedArtist
  year: number
  onClose: () => void
}

/** ±reach of the one-tap "show nearby years" widen. */
const NEARBY_REACH = 5

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; details: ArtistEraDetails }

/**
 * Search found an artist, not a place: answer "what did they put out
 * in this era?" — release groups by ORIGINAL release year, so later
 * remasters count for their first year and re-recordings don't leak
 * back in time. Honest empty state when the era holds nothing.
 */
export function ArtistEraPanel({
  artist,
  year,
  onClose,
}: ArtistEraPanelProps) {
  const { service } = useListenService()
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // One-tap widen when the single year holds nothing of their catalog.
  const [nearby, setNearby] = useState(false)

  const yearStart = nearby ? Math.max(YEAR_MIN, year - NEARBY_REACH) : year
  const yearEnd = nearby ? Math.min(YEAR_MAX, year + NEARBY_REACH) : year
  const spanLabel =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}–${yearEnd}`

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchArtistEra(artist.mbid, yearStart, yearEnd, controller.signal)
      .then((details) => setState({ status: 'ready', details }))
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error.message })
      })
    return () => controller.abort()
  }, [artist.mbid, yearStart, yearEnd, attempt])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <aside
      className={styles.panel}
      role="dialog"
      aria-label={`${artist.name}, ${spanLabel}`}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.country}>{artist.name}</h2>
          <p className={styles.year}>
            {spanLabel}
            {nearby && ' · around your year'}
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close panel"
        >
          ✕
        </button>
      </header>

      {state.status === 'loading' && (
        <>
          <p className={styles.note}>
            Finding what {artist.name} put out in {spanLabel}…
          </p>
          <div className={styles.skeleton} aria-hidden="true">
            <div className={styles.skeletonRows}>
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index} className={styles.skeletonRow} />
              ))}
            </div>
          </div>
        </>
      )}

      {state.status === 'error' && (
        <>
          <p className={styles.note}>{state.message}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && (
        <div className={styles.body}>
          {state.details.eraCount === 0 ? (
            <>
              <p className={styles.note}>
                Nothing on record from {artist.name} in {spanLabel} — their
                catalog lives in other years.
              </p>
              {!nearby && (
                <button
                  type="button"
                  className={styles.widen}
                  onClick={() => setNearby(true)}
                >
                  Show nearby years ({Math.max(YEAR_MIN, year - NEARBY_REACH)}
                  –{Math.min(YEAR_MAX, year + NEARBY_REACH)}) →
                </button>
              )}
            </>
          ) : (
            <>
              <p className={styles.total}>
                {state.details.eraCount.toLocaleString()} release
                {state.details.eraCount === 1 ? '' : 's'} in this era
                <span className={eraStyles.catalogNote}>
                  {' '}
                  · {state.details.catalogCount.toLocaleString()} all-time
                </span>
              </p>
              <ul className={styles.releases}>
                {state.details.eraReleases.map((release) => {
                  const listen = resolveListenHref(
                    service,
                    undefined,
                    artist.name,
                    release.title,
                  )
                  return (
                    <li key={release.id} className={styles.release}>
                      <div className={styles.releaseText}>
                        <a
                          className={styles.releaseTitle}
                          href={`https://musicbrainz.org/release-group/${release.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {release.title}
                        </a>
                        <span className={styles.releaseMeta}>
                          {release.date.slice(0, 4)}
                          {release.type ? ` · ${release.type}` : ''}
                        </span>
                      </div>
                      <a
                        className={styles.listenLink}
                        href={listen.href}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${listen.label}: ${release.title} by ${artist.name}`}
                      >
                        {listen.label} ↗
                      </a>
                    </li>
                  )
                })}
              </ul>
              {state.details.eraCount > state.details.eraReleases.length && (
                <p className={styles.truncationNote}>
                  Showing the first {state.details.eraReleases.length} of{' '}
                  {state.details.eraCount} in this era.
                </p>
              )}
            </>
          )}
          {nearby && (
            <button
              type="button"
              className={styles.widen}
              onClick={() => setNearby(false)}
            >
              ← Back to {year} only
            </button>
          )}
          <p className={eraStyles.methodNote}>
            By original release year (MusicBrainz release groups) — later
            reissues and re-recordings don&rsquo;t count backwards.
            {state.details.truncated &&
              ' Very large catalog: the sweep covers its first 200 groups.'}{' '}
            <a
              className={eraStyles.mbLink}
              href={musicBrainzArtistUrl(artist.mbid)}
              target="_blank"
              rel="noreferrer"
            >
              MusicBrainz ↗
            </a>
          </p>
        </div>
      )}
    </aside>
  )
}
