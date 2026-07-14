'use client'

import { useRef, useState } from 'react'
import type { UniversePost } from '@/lib/membership/types'
import { formatDuration } from '@/lib/audio'
import {
  KIND_LABELS,
  formatPostDate,
  mediaUrl,
} from '@/components/universe/postMeta'
import styles from './Universe.module.css'

interface UniversePostCardProps {
  slug: string
  post: UniversePost
}

export function UniversePostCard({ slug, post }: UniversePostCardProps) {
  return (
    <li className={styles.post}>
      <div className={styles.postMeta}>
        <span className={styles.postKind}>{KIND_LABELS[post.kind]}</span>
        <span className={styles.postDate}>{formatPostDate(post.createdAt)}</span>
      </div>
      <h3 className={styles.postTitle}>{post.title}</h3>

      {/* The image URL is member-gated by cookie; the next/image optimizer
          fetches server-side without the session and would always 401. */}
      {post.kind === 'image' && post.media && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.postImage}
          src={mediaUrl(slug, post.media)}
          alt={post.alt ?? post.title}
          loading="lazy"
        />
      )}
      {post.kind === 'audio' && post.media && (
        <AudioPostPlayer
          src={mediaUrl(slug, post.media)}
          duration={post.media.duration ?? 0}
          title={post.title}
        />
      )}

      {post.body &&
        post.body
          .split('\n\n')
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index} className={styles.postBody}>
              {paragraph}
            </p>
          ))}
    </li>
  )
}

function AudioPostPlayer({
  src,
  duration,
  title,
}: {
  src: string
  duration: number
  title: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [total, setTotal] = useState(duration)

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch((error) => {
        console.error('Playback failed:', error)
        setPlaying(false)
      })
    } else {
      audio.pause()
    }
  }

  function seek(value: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    setPosition(value)
  }

  return (
    <div className={styles.audioPlayer}>
      <button
        type="button"
        className={styles.audioToggle}
        onClick={toggle}
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className={styles.audioTime}>{formatDuration(position)}</span>
      <input
        className={styles.audioSeek}
        type="range"
        min={0}
        max={total || 1}
        step={1}
        value={Math.min(position, total || 1)}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label={`Seek within ${title}`}
      />
      <span className={styles.audioTime}>{formatDuration(total)}</span>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const real = event.currentTarget.duration
          if (Number.isFinite(real) && real > 0) setTotal(real)
        }}
        onEnded={() => {
          setPlaying(false)
          setPosition(0)
        }}
      />
    </div>
  )
}
