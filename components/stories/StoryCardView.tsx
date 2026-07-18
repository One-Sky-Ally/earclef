'use client'

import { useState } from 'react'
import type { StoryCard } from '@/lib/stories/types'
import styles from './StoryCardView.module.css'

interface StoryCardViewProps {
  card: StoryCard
  /** Feed cards show the artist name; artist pages already have it. */
  showArtist?: boolean
}

/**
 * One editorial story card: hook headline, short sourced story, verified
 * media links, and a collapsible source list — honesty is the format.
 */
export function StoryCardView({ card, showArtist = false }: StoryCardViewProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  return (
    <article className={styles.card}>
      {showArtist && (
        <a className={styles.artist} href={`/${card.slug}`}>
          {card.artistName}
        </a>
      )}
      <h3 className={styles.hook}>{card.hook}</h3>
      <p className={styles.story}>{card.story}</p>
      {card.media.length > 0 && (
        <ul className={styles.media}>
          {card.media.map((link) => (
            <li key={link.url}>
              <a
                className={styles.mediaLink}
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                ▶ {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.footerRow}>
        <span className={styles.label}>An Ear Clef story — AI-assisted, source-checked.</span>
        {card.sources.length > 0 && (
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
          {card.sources.map((source) => (
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
