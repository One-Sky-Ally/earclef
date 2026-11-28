'use client'

import { useEffect, useRef, useState } from 'react'
import { useYouTubeQueue } from '@/components/play/useYouTubeQueue'
import { LikeButton } from '@/components/fans/LikeButton'
import { Icon } from '@/components/ui/Icon'
import { SafeImage } from '@/components/ui/SafeImage'
import { youtubeThumb } from '@/lib/play/youtubeApi'
import styles from './PickPlayer.module.css'

export interface PickSong {
  videoId: string
  title: string
}

interface PickPlayerProps {
  artistName: string
  mbid: string
  /** The pick's own verified song. */
  song: PickSong
  /** More of the artist's own verified songs (lib/discover/types `more`). */
  more: readonly PickSong[]
  /** The listener pressed play: Discover marks the artist as played. */
  onPlay?: () => void
  /** What the pick's own song is ("Official video"), shown while it is the one showing. */
  songNote?: string
}

const VIDEO_ID = /^[\w-]{11}$/

/** Stored output outlives its code: only well-formed songs play. */
export function playableSongs(raw: unknown, ownVideoId: string): PickSong[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set([ownVideoId])
  return raw.flatMap((entry: Partial<PickSong> | null) => {
    if (!entry || typeof entry.videoId !== 'string' || !VIDEO_ID.test(entry.videoId)) return []
    if (typeof entry.title !== 'string' || entry.title === '' || seen.has(entry.videoId)) return []
    seen.add(entry.videoId)
    return [{ videoId: entry.videoId, title: entry.title }]
  })
}

/**
 * A Discover pick's player (owner, Nov 28 2026: "after I listen … keep
 * listening to more music from that artist. It must be that artist's
 * music only"). ▶ plays the pick's song, as before; "More from {artist}"
 * then plays the artist's other verified songs one after another —
 * every one passed the same identity bar as the pick's song. One
 * YouTube player per card, built only when something plays, and one
 * sound on the page at a time.
 */
export function PickPlayer({ artistName, mbid, song, more, onPlay, songNote }: PickPlayerProps) {
  // Until "More" is pressed the queue is the pick's song alone, so its
  // end never rolls on by itself into songs nobody asked for.
  const [moreOn, setMoreOn] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const tracks = moreOn ? [song, ...more] : [song]
  const { mountRef, current, ended, paused, broken, dead, playAt, toggleOrPlay } = useYouTubeQueue(
    tracks.map((track) => track.videoId),
  )
  // Set by the "More" press; played once the hook has the longer list.
  const startAt = useRef<number | null>(null)
  // Where keyboard focus goes when the play button it was on goes away.
  const nowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (startAt.current === null) return
    const at = startAt.current
    startAt.current = null
    playAt(at)
  })

  const playing = current !== null ? tracks[current] : null
  const shown = playing ?? song
  const like = (track: PickSong) => ({ videoId: track.videoId, title: track.title, artistName, mbid })

  function startMore() {
    // Listening to the artist is playing them, whichever song it starts on.
    onPlay?.()
    // The pick's song still playing finishes first; the queue rolls on from it.
    if (current !== 0 || ended || paused) startAt.current = 1
    setMoreOn(true)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.player}>
        <div ref={mountRef} className={styles.frame} />
        {current === null && (
          <button
            type="button"
            className={styles.facade}
            onClick={() => {
              onPlay?.()
              playAt(0)
              nowRef.current?.focus()
            }}
            aria-label={`Play ${song.title} by ${artistName}`}
          >
            <SafeImage className={styles.still} src={youtubeThumb(song.videoId)} />
            <span className={styles.facadePlay} aria-hidden="true">
              <Icon name="play" size={24} />
            </span>
          </button>
        )}
      </div>
      {broken && (
        <p className={styles.note}>
          The YouTube player didn’t load here.{' '}
          <a href={`https://www.youtube.com/watch?v=${shown.videoId}`} target="_blank" rel="noreferrer">
            Watch on YouTube ↗
          </a>
        </p>
      )}

      <div className={styles.nowRow} ref={nowRef} tabIndex={-1}>
        <span className={styles.title} aria-live="polite">
          {shown.title}
          {moreOn && current !== null && (
            <span className={styles.position}>
              {' '}
              · {current + 1} of {tracks.length}
            </span>
          )}
        </span>
        <LikeButton variant="row" track={like(shown)} />
      </div>
      {songNote && shown.videoId === song.videoId && <span className={styles.songNote}>{songNote}</span>}

      {more.length > 0 && !moreOn && (
        <button type="button" className={styles.more} onClick={startMore}>
          <Icon name="play" size={12} /> More from {artistName} · {more.length} song
          {more.length === 1 ? '' : 's'}
        </button>
      )}

      {moreOn && (
        <div className={styles.moreRow}>
          {ended ? (
            <span className={styles.note}>That’s every song by {artistName} that plays here.</span>
          ) : (
            <button
              type="button"
              className={styles.more}
              onClick={() => playAt(Math.min((current ?? 0) + 1, tracks.length - 1))}
              disabled={current === tracks.length - 1}
            >
              Next song ›
            </button>
          )}
          <button
            type="button"
            className={styles.listToggle}
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
          >
            {listOpen ? 'Hide the songs' : `All ${tracks.length} songs`}
          </button>
        </div>
      )}

      {moreOn && listOpen && (
        <ol className={styles.list}>
          {tracks.map((track, index) => {
            const isCurrent = index === current && !ended
            const isDead = dead.has(track.videoId)
            return (
              <li key={track.videoId} className={`${styles.row} ${isCurrent ? styles.rowCurrent : ''}`}>
                <span className={styles.rowTitle}>{isDead ? `${track.title} — no longer plays` : track.title}</span>
                {!isDead && (
                  <span className={styles.rowActions}>
                    <LikeButton variant="row" track={like(track)} />
                    <button
                      type="button"
                      className={styles.rowPlay}
                      onClick={() => toggleOrPlay(index)}
                      aria-label={`${isCurrent && !paused ? 'Pause' : 'Play'} “${track.title}”`}
                    >
                      <Icon name={isCurrent && !paused ? 'pause' : 'play'} size={12} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
