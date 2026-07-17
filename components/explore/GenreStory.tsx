'use client'

import { useEffect, useState } from 'react'
import { youtubeSearchUrl } from '@/lib/explore/panelData'
import styles from './GenreStory.module.css'

interface GenreStoryProps {
  genre: string
}

type StoryState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'ready'; story: string }

/** Split "[[Bob Marley]] led…" into text and linkable artist segments. */
function segments(story: string): { text: string; artist: boolean }[] {
  return story
    .split(/(\[\[[^\]]+\]\])/g)
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^\[\[([^\]]+)\]\]$/)
      return match
        ? { text: match[1], artist: true }
        : { text: part, artist: false }
    })
}

/**
 * The genre's origin-and-spread story — generated once ever, cached
 * forever, pioneers linked to YouTube searches like every listen
 * action on the site. Collapsible; hides entirely if unavailable.
 */
export function GenreStory({ genre }: GenreStoryProps) {
  const [state, setState] = useState<StoryState>({ status: 'loading' })
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/explore/genre-story/${encodeURIComponent(genre)}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { story?: string }
        if (!cancelled) {
          setState(
            body.story
              ? { status: 'ready', story: body.story }
              : { status: 'hidden' },
          )
        }
      } catch {
        if (!cancelled) setState({ status: 'hidden' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [genre])

  if (state.status === 'hidden') return null

  return (
    <aside className={styles.card} aria-label={`The ${genre} story`}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={styles.title}>The {genre} story</span>
        <span className={styles.chevron} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && state.status === 'loading' && (
        <div className={styles.shimmerBlock} aria-hidden="true">
          <span className={styles.shimmer} />
          <span className={styles.shimmer} />
          <span className={`${styles.shimmer} ${styles.shimmerShort}`} />
        </div>
      )}

      {open && state.status === 'ready' && (
        <>
          <p className={styles.story}>
            {segments(state.story).map((segment, index) =>
              segment.artist ? (
                <a
                  key={index}
                  className={styles.artistLink}
                  href={youtubeSearchUrl(`"${segment.text}" music`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {segment.text}
                </a>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </p>
          <p className={styles.label}>A short history, AI-assisted.</p>
        </>
      )}
    </aside>
  )
}
