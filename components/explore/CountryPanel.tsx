'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  fetchArtistLinks,
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
import { useListenService } from '@/components/listen/ServiceProvider'
import type { ListenService } from '@/lib/listen/services'
import type { ArtistLinks } from '@/lib/explore/panelData'
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


/** Session-lived client cache; the API layer caches for 30 days. */
const artistLinksCache = new Map<string, ArtistLinks>()

function smartArtistHref(
  links: ArtistLinks,
  service: ListenService,
): string | null {
  const serviceLink =
    service === 'spotify'
      ? links.spotify
      : service === 'appleMusic'
        ? links.appleMusic
        : service === 'amazonMusic'
          ? links.amazonMusic
          : links.youtube
  return serviceLink ?? links.website ?? links.wikipedia ?? null
}

interface PanelArtistPillProps {
  artist: PanelArtist
  releases: PanelRelease[]
  rosterEntry?: { slug: string; name: string }
}

/**
 * Artist pill: roster artists keep the gold home link; everyone else
 * gets a lazy smart chain on the name — the fan's streaming service if
 * MusicBrainz knows the link, else official site, else Wikipedia, else
 * MusicBrainz itself. Links resolve on first click (~1s) and cache.
 */
function PanelArtistPill({
  artist,
  releases,
  rosterEntry,
}: PanelArtistPillProps) {
  const { service } = useListenService()
  const [resolving, setResolving] = useState(false)

  async function openSmartLink(event: React.MouseEvent) {
    // Plain left-clicks resolve the chain; modified clicks keep the
    // MusicBrainz href for open-in-new-tab muscle memory.
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    let links = artistLinksCache.get(artist.id)
    if (!links) {
      setResolving(true)
      try {
        links = await fetchArtistLinks(artist.id, new AbortController().signal)
      } catch {
        links = {}
      }
      artistLinksCache.set(artist.id, links)
      setResolving(false)
    }
    const href = smartArtistHref(links, service) ?? musicBrainzArtistUrl(artist.id)
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <li className={styles.artistItem}>
      {rosterEntry ? (
        <Link
          className={`${styles.artistPill} ${styles.onRoster}`}
          href={`/${rosterEntry.slug}`}
          title="On the Ear Clef roster — opens their page here"
        >
          {artist.name}
        </Link>
      ) : (
        <a
          className={`${styles.artistPill} ${resolving ? styles.pillResolving : ''}`}
          href={musicBrainzArtistUrl(artist.id)}
          onClick={openSmartLink}
          target="_blank"
          rel="noreferrer"
        >
          {resolving ? `${artist.name}…` : artist.name}
        </a>
      )}
      <a
        className={styles.listenBadge}
        href={artistSearchHref(artist, releases)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Listen: search YouTube for ${artist.name}`}
      >
        ▶
      </a>
    </li>
  )
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
  const [showAllOrigin, setShowAllOrigin] = useState(false)
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
        <>
          <p className={styles.note}>
            Listening for {spanLabel} in {country.name}…
          </p>
          <div className={styles.skeleton} aria-hidden="true">
            <div className={styles.skeletonPills}>
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index} className={styles.skeletonPill} />
              ))}
            </div>
            <div className={styles.skeletonRows}>
              {Array.from({ length: 4 }, (_, index) => (
                <span key={index} className={styles.skeletonRow} />
              ))}
            </div>
          </div>
        </>
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

          {state.details.originArtists.length > 0 && (
            <>
              <h3 className={styles.subheading}>Top artists from {country.name}</h3>
              <ul className={styles.artists}>
                {(showAllOrigin
                  ? state.details.originArtists
                  : state.details.originArtists.slice(0, PREVIEW_COUNT)
                ).map((artist) => (
                  <PanelArtistPill
                    key={artist.id}
                    artist={artist}
                    releases={state.details.releases}
                    rosterEntry={roster[artist.id]}
                  />
                ))}
              </ul>
              {state.details.originArtists.length > PREVIEW_COUNT && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setShowAllOrigin((value) => !value)}
                >
                  {showAllOrigin
                    ? 'Show fewer'
                    : `Show all ${state.details.originArtists.length}`}
                </button>
              )}
            </>
          )}

          {state.details.originArtists.length === 0 &&
            state.details.artists.length > 0 && (
            <>
              <h3 className={styles.subheading}>On these releases</h3>
              <ul className={styles.artists}>
                {(showAllArtists
                  ? state.details.artists
                  : state.details.artists.slice(0, PREVIEW_COUNT)
                ).map((artist) => (
                  <PanelArtistPill
                    key={artist.id}
                    artist={artist}
                    releases={state.details.releases}
                    rosterEntry={roster[artist.id]}
                  />
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
              <h3 className={styles.subheading}>
                {state.details.originArtists.length > 0
                  ? `Released in ${country.name}`
                  : 'Releases'}
              </h3>
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
