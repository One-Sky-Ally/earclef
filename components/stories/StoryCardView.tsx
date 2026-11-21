'use client'

import { useRef, useState } from 'react'
import { storyMediaAction } from '@/lib/stories/mediaLink'
import type { StoryCard } from '@/lib/stories/types'
import { useOneSound } from '@/components/play/useOneSound'
import { Icon } from '@/components/ui/Icon'
import styles from './StoryCardView.module.css'

interface StoryCardViewProps {
  card: StoryCard
  /** Feed cards show the artist name; artist pages already have it. */
  showArtist?: boolean
}

interface PlayingVideo {
  videoId: string
  label: string
}

/**
 * One editorial story card: hook headline, short sourced story, verified
 * media links, and a collapsible source list — honesty is the format.
 */
export function StoryCardView({ card, showArtist = false }: StoryCardViewProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  // A card's videos play inside it (owner, Nov 21 2026), one at a time,
  // and under the page's one-sound rule: another player starting closes
  // this one.
  const [playing, setPlaying] = useState<PlayingVideo | null>(null)
  const { claim } = useOneSound(() => setPlaying(null))
  /**
   * Never trust the stored shape. cards.json declared `media` as an
   * array and 77 cards carried `media: null`, so `card.media.length`
   * threw and Next's error boundary replaced /feed and 37 artist pages
   * with "This page couldn't load" (Aug 2026). The data is repaired and
   * assemble() now validates, but stored output outlives its generator
   * — a card that cannot render its links must cost its links, never
   * the page.
   */
  const media = Array.isArray(card.media) ? card.media : []
  const sources = Array.isArray(card.sources) ? card.sources : []

  const listRef = useRef<HTMLUListElement>(null)

  const toggle = (video: PlayingVideo) => {
    if (playing?.videoId === video.videoId) {
      setPlaying(null)
      return
    }
    claim()
    setPlaying(video)
  }
  // "Close player" goes away with the player; keyboard and screen-reader
  // users land back on the link that opened it, not the page top.
  const close = () => {
    listRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?.focus()
    setPlaying(null)
  }

  return (
    <article className={styles.card}>
      {showArtist && (
        <a className={styles.artist} href={`/${card.slug}`}>
          {card.artistName}
        </a>
      )}
      <h3 className={styles.hook}>{card.hook}</h3>
      <p className={styles.story}>{card.story}</p>
      {media.length > 0 && (
        <ul className={styles.media} ref={listRef}>
          {media.map((link, index) => {
            const action = storyMediaAction(link)
            const isPlaying =
              action.kind === 'play' && playing?.videoId === action.videoId
            return (
              <li key={`${index}-${link.url}`}>
                {action.kind === 'play' ? (
                  // Pressed, it stops: ■ while playing, ▶ only when a
                  // click plays. The name stays put; aria-pressed
                  // carries the state.
                  <button
                    type="button"
                    className={styles.mediaLink}
                    onClick={() => toggle(action)}
                    aria-pressed={isPlaying}
                    aria-label={`Play here: ${action.label}`}
                  >
                    {isPlaying ? '■' : '▶'} {action.label}
                  </button>
                ) : (
                  <a
                    className={styles.mediaLink}
                    href={action.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {action.text}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {playing && (
        <div className={styles.player}>
          <div className={styles.screen}>
            <iframe
              key={playing.videoId}
              className={styles.frame}
              src={`https://www.youtube-nocookie.com/embed/${playing.videoId}?autoplay=1&playsinline=1&rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={`YouTube player: ${playing.label}`}
            />
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label={`Close player: ${playing.label}`}
          >
            Close player
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <div className={styles.footerRow}>
        <span className={styles.label}>An Ear Clef story — AI-assisted, source-checked.</span>
        {sources.length > 0 && (
          <button
            type="button"
            className={styles.sourcesToggle}
            onClick={() => setSourcesOpen((open) => !open)}
            aria-expanded={sourcesOpen}
          >
            Sources {sourcesOpen ? '▾' : '▸'}
          </button>
        )}
      </div>
      {sourcesOpen && (
        <ul className={styles.sources}>
          {sources.map((source) => (
            <li key={source.url}>
              <a
                className={styles.sourceLink}
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.publisher} — {source.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
