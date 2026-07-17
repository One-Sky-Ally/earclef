'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  fetchCountryYearDetails,
  musicBrainzArtistUrl,
  musicBrainzReleaseUrl,
  youtubeSearchUrl,
  type CountryYearDetails,
  type PanelArtist,
  type PanelRelease,
} from '@/lib/explore/panelData'
import type { DataSource } from '@/lib/explore/counts'
import { archiveAudioSearchUrl, listenSearch } from '@/lib/links'
import styles from './CountryPanel.module.css'

export interface SelectedCountry {
  code: string
  name: string
}

/** MBID → roster page, so globe artists who live here link home. */
export type RosterByMbid = Record<string, { slug: string; name: string }>

interface CountryPanelProps {
  country: SelectedCountry
  yearStart: number
  yearEnd: number
  source: DataSource | null
  roster?: RosterByMbid
  onClose: () => void
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; details: CountryYearDetails }

const PREVIEW_COUNT = 5

// listenSearch quotes the title but leaves the artist bare, so name variants
// can't zero out the results while the search stays on-target ("Black Widow"
// the band, not the Marvel film). Artists get their top release as a
// discriminator.
function releaseSearchHref(release: PanelRelease): string {
  return listenSearch(release.artist.name, release.title)
}

function artistSearchHref(
  artist: PanelArtist,
  releases: PanelRelease[],
): string {
  const topRelease = releases.find(
    (release) => release.artist.id === artist.id,
  )?.title
  return topRelease
    ? listenSearch(artist.name, topRelease)
    : youtubeSearchUrl(`"${artist.name}" music`)
}

export function CountryPanel({
  country,
  yearStart,
  yearEnd,
  source,
  roster = {},
  onClose,
}: CountryPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllReleases, setShowAllReleases] = useState(false)

  const spanLabel =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}–${yearEnd}`

  // Parent keys this component by country+range, so every fetch cycle
  // starts from a fresh mount in the 'loading' state.
  useEffect(() => {
    const controller = new AbortController()

    fetchCountryYearDetails(country.code, yearStart, yearEnd, controller.signal)
      .then((details) => setState({ status: 'ready', details }))
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error.message })
      })

    return () => controller.abort()
  }, [country.code, yearStart, yearEnd])

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
      aria-label={`${country.name}, ${spanLabel}`}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.country}>{country.name}</h2>
          <p className={styles.year}>{spanLabel}</p>
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
        <p className={styles.note}>Listening for {spanLabel} in {country.name}…</p>
      )}

      {state.status === 'error' && (
        <p className={styles.note}>{state.message}</p>
      )}

      {state.status === 'ready' && (
        <div className={styles.body}>
          <p className={styles.total}>
            {state.details.totalCount.toLocaleString()} releases issued here
          </p>
          {state.details.totalCount > 0 && (
            <p className={styles.methodNote}>
              Counted by where releases were issued or distributed — artists
              may hail from elsewhere.
            </p>
          )}

          {state.details.totalCount === 0 && (
            <p className={styles.note}>
              Nothing on record here for {spanLabel} — yet. MusicBrainz grows every
              day.
            </p>
          )}

          {state.details.artists.length > 0 && (
            <>
              <h3 className={styles.subheading}>On these releases</h3>
              <ul className={styles.artists}>
                {(showAllArtists
                  ? state.details.artists
                  : state.details.artists.slice(0, PREVIEW_COUNT)
                ).map((artist) => (
                  <li key={artist.id} className={styles.artistItem}>
                    {roster[artist.id] ? (
                      <Link
                        className={`${styles.artistPill} ${styles.onRoster}`}
                        href={`/${roster[artist.id].slug}`}
                        title="On the Ear Clef roster — opens their page here"
                      >
                        {artist.name}
                      </Link>
                    ) : (
                      <a
                        className={styles.artistPill}
                        href={musicBrainzArtistUrl(artist.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {artist.name}
                      </a>
                    )}
                    <a
                      className={styles.listenBadge}
                      href={artistSearchHref(artist, state.details.releases)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Listen: search YouTube for ${artist.name}`}
                    >
                      ▶
                    </a>
                  </li>
                ))}
              </ul>
              {state.details.artists.length > PREVIEW_COUNT && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setShowAllArtists((value) => !value)}
                >
                  {showAllArtists
                    ? 'Show fewer'
                    : `Show all ${state.details.artists.length}`}
                </button>
              )}
            </>
          )}

          {state.details.releases.length > 0 && (
            <>
              <h3 className={styles.subheading}>Releases</h3>
              <ul className={styles.releases}>
                {(showAllReleases
                  ? state.details.releases
                  : state.details.releases.slice(0, PREVIEW_COUNT)
                ).map((release) => (
                  <li key={release.id} className={styles.release}>
                    <div className={styles.releaseText}>
                      <a
                        className={styles.releaseTitle}
                        href={musicBrainzReleaseUrl(release.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {release.title}
                      </a>
                      <span className={styles.releaseMeta}>
                        {release.artist.name}
                        {release.date ? ` · ${release.date}` : ''}
                      </span>
                    </div>
                    <a
                      className={styles.listenLink}
                      href={releaseSearchHref(release)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Listen: search YouTube for ${release.title} by ${release.artist.name}`}
                    >
                      ▶ Listen
                    </a>
                    {yearEnd < 1950 && (
                      <a
                        className={styles.listenLink}
                        href={archiveAudioSearchUrl(
                          release.artist.name,
                          release.title,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Search the Internet Archive for ${release.title} by ${release.artist.name}`}
                      >
                        Archive ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {state.details.releases.length > PREVIEW_COUNT && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setShowAllReleases((value) => !value)}
                >
                  {showAllReleases
                    ? 'Show fewer'
                    : `Show all ${state.details.releases.length}`}
                </button>
              )}
              {showAllReleases &&
                state.details.totalCount > state.details.releases.length && (
                  <p className={styles.truncationNote}>
                    Showing the first {state.details.releases.length} of{' '}
                    {state.details.totalCount.toLocaleString()} on record.
                  </p>
                )}
            </>
          )}

          {source === 'simulated' && (
            <p className={styles.disclaimer}>
              The heat map is simulated for now — this list is live from
              MusicBrainz.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
