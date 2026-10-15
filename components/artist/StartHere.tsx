'use client'

import { useState } from 'react'
import { youtubeThumb } from '@/lib/play/youtubeApi'
import { useYouTubeQueue } from '@/components/play/useYouTubeQueue'
import { LikeButton } from '@/components/fans/LikeButton'
import { Icon } from '@/components/ui/Icon'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './StartHere.module.css'

export interface StartHereTrack {
  videoId: string
  title: string
  /** "OK Computer · 1997", or "Ear Clef pick" for a hand-picked video. */
  detail?: string
  year?: number
}

/** Rows before "Show more" — the mockup's five essentials. */
const FIRST_ROWS = 5

/**
 * "Start here": the artist's songs that play on the site — the videos
 * hand-picked for the page first, then other verified songs. One
 * visible YouTube player; press a row to hear it, or play them all.
 */
export function StartHere({
  artistName,
  mbid,
  tracks,
}: {
  artistName: string
  mbid?: string
  tracks: StartHereTrack[]
}) {
  const [showAll, setShowAll] = useState(false)
  const { mountRef, current, ended, paused, broken, dead, toggleOrPlay, playAll } =
    useYouTubeQueue(tracks.map((track) => track.videoId))

  if (tracks.length === 0) return null
  const visible = showAll ? tracks : tracks.slice(0, FIRST_ROWS)
  const first = tracks[0]
  const playing = current !== null ? tracks[current] : null

  return (
    <div className={styles.layout}>
      <div className={styles.listColumn}>
        <ol className={styles.list}>
          {visible.map((track, index) => {
            const isCurrent = index === current && !ended
            const isDead = dead.has(track.videoId)
            return (
              <li
                key={track.videoId}
                className={`${styles.row} ${isCurrent ? styles.rowCurrent : ''}`}
              >
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.art} aria-hidden="true">
                  <SafeImage src={youtubeThumb(track.videoId, 'mq')} />
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{track.title}</span>
                  <span className={styles.detail}>
                    {isDead ? 'No longer plays on YouTube' : track.detail}
                  </span>
                </span>
                {!isDead && (
                  <span className={styles.actions}>
                    <LikeButton
                      variant="row"
                      track={{
                        videoId: track.videoId,
                        title: track.title,
                        artistName,
                        ...(mbid ? { mbid } : {}),
                        ...(track.year ? { year: track.year } : {}),
                      }}
                    />
                    <button
                      type="button"
                      className={styles.play}
                      onClick={() => toggleOrPlay(index)}
                      aria-label={`${isCurrent && !paused ? 'Pause' : 'Play'} “${track.title}”`}
                    >
                      <Icon name={isCurrent && !paused ? 'pause' : 'play'} size={14} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        {tracks.length > FIRST_ROWS && (
          <button
            type="button"
            className={styles.more}
            onClick={() => setShowAll((open) => !open)}
            aria-expanded={showAll}
          >
            {showAll ? 'Show fewer' : `Show all ${tracks.length}`}
          </button>
        )}
      </div>
      <div className={styles.side}>
        <div className={styles.player}>
          <div ref={mountRef} className={styles.frame} />
          {current === null && (
            <button
              type="button"
              className={styles.facade}
              onClick={playAll}
              aria-label={`Play ${artistName}, starting with ${first.title}`}
            >
              <SafeImage className={styles.still} src={youtubeThumb(first.videoId)} />
              <span className={styles.facadePlay} aria-hidden="true">
                <Icon name="play" size={26} />
              </span>
              <span className={styles.facadeNote}>Plays here on YouTube</span>
            </button>
          )}
        </div>
        {broken && playing && (
          <p className={styles.note}>
            The YouTube player didn’t load here.{' '}
            <a href={`https://www.youtube.com/watch?v=${playing.videoId}`} target="_blank" rel="noreferrer">
              Watch “{playing.title}” on YouTube ↗
            </a>
          </p>
        )}
        <p className={styles.note} aria-live="polite">
          {playing
            ? ended
              ? 'That’s every song here.'
              : `Now playing: “${playing.title}”`
            : `${tracks.length} song${tracks.length === 1 ? '' : 's'}, each verified to play here.`}
        </p>
      </div>
    </div>
  )
}
