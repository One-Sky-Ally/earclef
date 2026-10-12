'use client'

import { useState } from 'react'
import type { FeaturedAlbum } from '@/lib/types'
import { fetchAlbumDetails } from '@/lib/artist/browserData'
import {
  archiveAudioSearchUrl,
  bandcampSearchUrl,
  coverArtUrl,
} from '@/lib/links'
import {
  resolveListenHref,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import { useListenService } from '@/components/listen/ServiceProvider'
import styles from './AlbumCard.module.css'

interface AlbumCardProps {
  album: FeaturedAlbum
  artistName: string
  /** Show a Bandcamp search when the artist's catalog lives there. */
  hasBandcamp?: boolean
  presence?: ArtistServicePresence
}

type TracksState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; tracks: string[] }

/**
 * A featured album: artwork, title, year, and the fan's way to the
 * music. The site hosts nothing — the card links to the fan's chosen
 * service (ServicePicker, site-wide) as a SEARCH, labeled as one:
 * "Search on Apple Music ↗", never ▶. An artist confirmed absent from
 * that service gets a small note where the link would be (owner rule,
 * Oct 13 2026), never a silent reroute.
 */
export function AlbumCard({
  album,
  artistName,
  hasBandcamp = false,
  presence,
}: AlbumCardProps) {
  const { service } = useListenService()
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

  const resolved = resolveListenHref(service, presence, artistName, album.title)
  const pre1950 = album.year !== undefined && Number(album.year) < 1950

  const head = (
    <>
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
        {resolved.kind === 'search' ? (
          // A search, labeled as one — ▶ would promise playback.
          <span className={styles.listenHint}>{resolved.label} ↗</span>
        ) : (
          <span className={styles.absentNote} title={resolved.note}>
            *{resolved.note}
          </span>
        )}
      </span>
    </>
  )

  return (
    <article className={styles.card}>
      {resolved.kind === 'search' ? (
        <a
          className={styles.head}
          href={resolved.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${resolved.label}: ${album.title} by ${artistName}`}
        >
          {head}
        </a>
      ) : (
        <div className={styles.head}>{head}</div>
      )}

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
              Search Bandcamp ↗
            </a>
          )}
          {pre1950 && (
            <a
              className={styles.sourceLink}
              href={archiveAudioSearchUrl(artistName, album.title)}
              target="_blank"
              rel="noreferrer"
            >
              Search Internet Archive ↗
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
          {tracksState.tracks.map((track, index) => {
            const link = resolveListenHref(service, presence, artistName, track)
            return (
              <li key={`${index}-${track}`}>
                {link.kind === 'search' ? (
                  <a
                    className={styles.track}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    title={`${link.label} ↗`}
                  >
                    {track}
                  </a>
                ) : (
                  <span className={styles.trackStatic}>{track}</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </article>
  )
}
