'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlayContent } from '@/lib/types'
import { audioUrl, formatDuration } from '@/lib/audio'
import { SectionHeader } from '@/components/SectionHeader'
import styles from './PlaySection.module.css'

interface PlaySectionProps {
  play: PlayContent
  artistName: string
  slug: string
}

export function PlaySection({ play, artistName, slug }: PlaySectionProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  // The ref is the source of truth for playback control (event handlers on
  // media elements can fire between React flushes); state mirrors it for UI.
  const currentRef = useRef(0)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  const track = play.tracks[current]
  const trackDuration = track?.duration ?? 0

  // Lock-screen / hardware-key metadata and controls where supported.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: artistName,
      album: play.album,
    })
  }, [track, artistName, play.album])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    session.setActionHandler('play', () => audioRef.current?.play())
    session.setActionHandler('pause', () => audioRef.current?.pause())
    session.setActionHandler('previoustrack', () => step(-1))
    session.setActionHandler('nexttrack', () => step(1))
    return () => {
      session.setActionHandler('play', null)
      session.setActionHandler('pause', null)
      session.setActionHandler('previoustrack', null)
      session.setActionHandler('nexttrack', null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read refs/state via closures created once
  }, [])

  function selectTrack(index: number, autoplay = true) {
    const audio = audioRef.current
    if (!audio || !play.tracks[index]) return
    currentRef.current = index
    setCurrent(index)
    setPosition(0)
    audio.src = audioUrl(slug, play.tracks[index].file)
    if (autoplay) {
      audio.play().catch((error) => {
        console.error('Playback failed:', error)
        setPlaying(false)
      })
    }
  }

  function step(direction: 1 | -1) {
    const audio = audioRef.current
    if (!audio) return
    // Restart the current track when stepping back mid-song.
    if (direction === -1 && audio.currentTime > 3) {
      audio.currentTime = 0
      setPosition(0)
      return
    }
    const next = currentRef.current + direction
    if (next < 0 || next >= play.tracks.length) return
    selectTrack(next, !audio.paused || playing)
  }

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.src) {
      selectTrack(currentRef.current)
      return
    }
    if (audio.paused) {
      audio.play().catch((error) => {
        console.error('Playback failed:', error)
        setPlaying(false)
      })
    } else {
      audio.pause()
    }
  }

  function onEnded() {
    const nextIndex = currentRef.current + 1
    if (nextIndex < play.tracks.length) {
      selectTrack(nextIndex)
    } else {
      // End of the album: rest at the top, ready to spin again.
      currentRef.current = 0
      setPlaying(false)
      setPosition(0)
      setCurrent(0)
      const audio = audioRef.current
      if (audio) audio.removeAttribute('src')
    }
  }

  function seek(value: number) {
    const audio = audioRef.current
    if (!audio || !audio.src) return
    audio.currentTime = value
    setPosition(value)
  }

  if (!track) return null

  return (
    <section id="play" className="section" aria-labelledby="play-heading">
      <div className="container">
        <SectionHeader number="00" title="Play" headingId="play-heading" />
        <p className={styles.rights}>{play.note ?? play.rights}</p>

        <div className={styles.player}>
          <div className={styles.transport}>
            <button
              type="button"
              className={styles.skip}
              onClick={() => step(-1)}
              aria-label="Previous track"
            >
              ⏮
            </button>
            <button
              type="button"
              className={styles.playPause}
              onClick={toggle}
              aria-label={playing ? 'Pause' : `Play ${track.title}`}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <button
              type="button"
              className={styles.skip}
              onClick={() => step(1)}
              aria-label="Next track"
            >
              ⏭
            </button>
            <div className={styles.nowPlaying}>
              <span className={styles.trackTitle}>{track.title}</span>
              {play.album && (
                <span className={styles.albumTitle}>{play.album}</span>
              )}
            </div>
          </div>

          <div className={styles.seekRow}>
            <span className={styles.time}>{formatDuration(position)}</span>
            <input
              className={styles.seek}
              type="range"
              min={0}
              max={trackDuration}
              step={1}
              value={Math.min(position, trackDuration)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="Seek"
            />
            <span className={styles.time}>{formatDuration(trackDuration)}</span>
          </div>

          <ol className={styles.tracklist}>
            {play.tracks.map((entry, index) => (
              <li key={entry.file}>
                <button
                  type="button"
                  className={`${styles.trackRow} ${
                    index === current ? styles.trackActive : ''
                  }`}
                  onClick={() =>
                    index === current ? toggle() : selectTrack(index)
                  }
                >
                  <span className={styles.trackIndex} aria-hidden="true">
                    {index === current && playing
                      ? '▶'
                      : String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.trackName}>{entry.title}</span>
                  <span className={styles.trackTime}>
                    {formatDuration(entry.duration)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <audio
          ref={audioRef}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) =>
            setPosition(event.currentTarget.currentTime)
          }
          onEnded={onEnded}
        />
      </div>
    </section>
  )
}
