'use client'

import { useState } from 'react'
import { musicServiceSearchUrl } from '@/lib/listen/services'
import { isSearchUrl } from '@/lib/play/storedHref'
import type { StoryCard } from '@/lib/stories/types'
import styles from './StoryCardView.module.css'

/**
 * cards.json predates the YouTube-search ban and its media lists mix
 * verified watch URLs with search URLs. Stored output outlives its
 * generator — convert search URLs to labeled music-service searches
 * at render, and reserve ▶ for links that actually play.
 */
function mediaLink(link: {
  label: string
  url: string
}): { href: string; text: string } {
  if (isSearchUrl(link.url)) {
    return {
      href: musicServiceSearchUrl('appleMusic', link.label),
      text: `${link.label} — search on Apple Music ↗`,
    }
  }
  return { href: link.url, text: `▶ ${link.label}` }
}

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
        <ul className={styles.media}>
          {media.map((link) => {
            const resolved = mediaLink(link)
            return (
              <li key={link.url}>
                <a
                  className={styles.mediaLink}
                  href={resolved.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {resolved.text}
                </a>
              </li>
            )
          })}
        </ul>
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
