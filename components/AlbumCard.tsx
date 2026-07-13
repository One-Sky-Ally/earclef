'use client'

import { useState } from 'react'
import type { FeaturedAlbum } from '@/lib/types'
import { fetchAlbumDetails } from '@/lib/artist/browserData'
import {
  archiveAudioSearchUrl,
  bandcampSearchUrl,
  coverArtUrl,
  listenSearch,
} from '@/lib/links'
import styles from './AlbumCard.module.css'

interface AlbumCardProps {
  album: FeaturedAlbum
  artistName: string
  /** Show a Bandcamp search when the artist's catalog lives there. */
  hasBandcamp?: boolean
}

type TracksState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; tracks: string[] }

export function AlbumCard({
  album,
  artistName,
  hasBandcamp = false,
}: AlbumCardProps) {
  const [tracksState, setTracksState] = useState<TracksState>({
    status: 'closed',
  })

  async function toggleTracks() {
    if (tracksState.status === 'ready' || tracksState.status === 'error') {
      setTracksState({ status: 'closed' })
      return
    }
    if (!album.mbReleaseGroupId) return
    setTracksState({ status: 'loading' })
    try {
      const details = await fetchAlbumDetails(
        album.mbReleaseGroupId,
        new AbortController().signal,
      )
      setTracksState(
        details.tracks.length > 0
          ? { status: 'ready', tracks: details.tracks }
          : { status: 'error' },
      )
    } catch {
      setTracksState({ status: 'error' })
    }
  }

  const searchHref = listenSearch(artistName, album.title)
  const pre1950 = album.year !== undefined && Number(album.year) < 1950

  return (
    <article className={styles.card}>
      <a
        className={styles.head}
        href={searchHref}
        target="_blank"
        rel="noreferrer"
        aria-label={`Listen: search YouTube for ${album.title} by ${artistName}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.cover}
          src={
            album.mbReleaseGroupId
              ? coverArtUrl(album.mbReleaseGroupId)
              : '/images/hero-placeholder.svg'
          }
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.src = '/images/hero-placeholder.svg'
          }}
        />
        <span className={styles.info}>
          <span className={styles.title}>{album.title}</span>
          {album.year && <span className={styles.year}>{album.year}</span>}
          <span className={styles.listenHint}>▶ Listen on YouTube</span>
        </span>
      </a>

      {(hasBandcamp || pre1950) && (
        <p className={styles.sources}>
          Also try:{' '}
          {hasBandcamp && (
            <a
              className={styles.sourceLink}
              href={bandcampSearchUrl(artistName, album.title)}
              target="_blank"
              rel="noreferrer"
            >
              Bandcamp ↗
            </a>
          )}
          {pre1950 && (
            <a
              className={styles.sourceLink}
              href={archiveAudioSearchUrl(artistName, album.title)}
              target="_blank"
              rel="noreferrer"
            >
              Internet Archive ↗
            </a>
          )}
        </p>
      )}

      {album.mbReleaseGroupId && (
        <button
          type="button"
          className={styles.tracksToggle}
          onClick={toggleTracks}
        >
          {tracksState.status === 'closed'
            ? 'Tracklist'
            : tracksState.status === 'loading'
              ? 'Loading…'
              : 'Hide tracklist'}
        </button>
      )}

      {tracksState.status === 'error' && (
        <p className={styles.tracksNote}>Tracklist unavailable right now.</p>
      )}

      {tracksState.status === 'ready' && (
        <ol className={styles.tracks}>
          {tracksState.tracks.map((track, index) => (
            <li key={`${index}-${track}`}>
              <a
                className={styles.track}
                href={listenSearch(artistName, track)}
                target="_blank"
                rel="noreferrer"
              >
                {track}
              </a>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}
