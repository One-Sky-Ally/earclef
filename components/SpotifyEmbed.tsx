'use client'

import { useState } from 'react'
import type { EmbedRef } from '@/lib/types'
import styles from './SpotifyEmbed.module.css'

const EMBED_HEIGHT = 352

interface SpotifyEmbedProps {
  embed: EmbedRef
}

export function SpotifyEmbed({ embed }: SpotifyEmbedProps) {
  const [loaded, setLoaded] = useState(false)

  if (loaded) {
    return (
      <iframe
        className={styles.frame}
        src={`https://open.spotify.com/embed/${embed.kind}/${embed.id}`}
        height={EMBED_HEIGHT}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        title={`Spotify player: ${embed.title}`}
      />
    )
  }

  return (
    <button
      type="button"
      className={styles.facade}
      style={{ height: EMBED_HEIGHT }}
      onClick={() => setLoaded(true)}
      aria-label={`Load Spotify player for ${embed.title}`}
    >
      <span className={styles.playIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
      <span className={styles.title}>{embed.title}</span>
      <span className={styles.kind}>
        {embed.kind} · Spotify — tap to load player
      </span>
    </button>
  )
}
