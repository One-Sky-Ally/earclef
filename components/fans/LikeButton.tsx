'use client'

import { useLikes, type LikeDraft } from '@/components/fans/LikesProvider'
import styles from './LikeButton.module.css'

interface LikeButtonProps {
  track: LikeDraft
  /** `row` is the quieter variant used down a queue list. */
  variant?: 'now' | 'row'
}

/**
 * The ♥ on a track. Saves instantly to this browser and, for signed-in
 * fans, to their record — no sign-in wall in front of liking a song
 * that is playing right now.
 */
export function LikeButton({ track, variant = 'now' }: LikeButtonProps) {
  const { isLiked, toggleLike, ready } = useLikes()
  const liked = isLiked(track.videoId)
  const label = `${liked ? 'Remove' : 'Save'} ${track.title} by ${track.artistName}`

  return (
    <button
      type="button"
      className={`${styles.like} ${variant === 'row' ? styles.row : styles.now} ${
        liked ? styles.on : ''
      }`}
      onClick={() => toggleLike(track)}
      aria-pressed={liked}
      aria-label={label}
      title={liked ? 'Saved — tap to remove' : 'Save this song'}
      // Until the stored likes are read, the ♥ would show "not liked"
      // for a song that is: wait rather than lie about it.
      disabled={!ready}
    >
      {liked ? '♥' : '♡'}
    </button>
  )
}
