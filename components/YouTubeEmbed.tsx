'use client'

import { useState } from 'react'
import type { VideoRef } from '@/lib/types'
import { useOneSound } from '@/components/play/useOneSound'
import styles from './YouTubeEmbed.module.css'
import { countPlay } from '@/lib/tally/beacon'

interface YouTubeEmbedProps {
  video: VideoRef
  index?: number
  /** Another player on the page started, and this one closed for it. */
  onStopped?: () => void
}

export function YouTubeEmbed({ video, index, onStopped }: YouTubeEmbedProps) {
  const [loaded, setLoaded] = useState(false)
  // One sound at a time (lib/play/oneSound.ts). A plain embed can't be
  // paused from outside, so another player starting puts this one back
  // to its still — the sound stops, and ▶ plays it again.
  const { claim } = useOneSound(() => {
    setLoaded(false)
    onStopped?.()
  })

  return (
    // data-playing once the video is loaded: the Explore page keeps a
    // panel with a playing embed alive while the visitor looks elsewhere.
    <figure className={styles.wrapper} data-playing={loaded ? 'true' : undefined}>
      <div className={styles.player}>
        {loaded ? (
          <iframe
            className={styles.frame}
            src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`YouTube player: ${video.title}`}
          />
        ) : (
          <button
            type="button"
            className={styles.facade}
            onClick={() => {
              claim()
              setLoaded(true)
              countPlay(video.youtubeId)
            }}
            aria-label={`Play video: ${video.title}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.thumb}
              src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
            />
            <span className={styles.playIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <figcaption className={styles.caption}>
        {index !== undefined && (
          <span className={styles.index} aria-hidden="true">
            {String(index).padStart(2, '0')}
          </span>
        )}
        {video.title}
      </figcaption>
    </figure>
  )
}
