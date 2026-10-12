'use client'

import { useState } from 'react'
import type { FeaturedAlbum } from '@/lib/types'
import { fetchAlbumDetails } from '@/lib/artist/browserData'
import { coverArtUrl } from '@/lib/links'
import styles from './AlbumCard.module.css'

interface AlbumCardProps {
  album: FeaturedAlbum
  artistName: string
}

type TracksState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; tracks: string[] }

/**
 * A featured album: artwork, title, year and a tracklist read from
 * MusicBrainz. NO LINKS (owner ruling, Oct 12 2026): the card used to
 * open a music-service search, which breaks the no-search-links rule
 * — a search is a guess, not a destination. Verified per-album links
 * come later; until then the card informs and promises nothing.
 */
export function AlbumCard({ album, artistName }: AlbumCardProps) {
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

  return (
    <article
      className={styles.card}
      aria-label={`${album.title} by ${artistName}`}
    >
      <div className={styles.head}>
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
        </span>
      </div>

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
            <li key={`${index}-${track}`} className={styles.track}>
              {track}
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}
