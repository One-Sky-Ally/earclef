'use client'

import { useState } from 'react'
import type { VideoRef } from '@/lib/types'
import styles from './YouTubeEmbed.module.css'

interface YouTubeEmbedProps {
  video: VideoRef
  index?: number
}

export function YouTubeEmbed({ video, index }: YouTubeEmbedProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <figure className={styles.wrapper}>
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
            onClick={() => setLoaded(true)}
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
