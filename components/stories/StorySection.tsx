'use client'

import { useEffect, useState } from 'react'
import type { StoryCard } from '@/lib/stories/types'
import { StoryCardView } from '@/components/stories/StoryCardView'
import styles from './StorySection.module.css'

interface StorySectionProps {
  slug: string
  artistName: string
}

type SectionState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'ready'; cards: StoryCard[] }

/**
 * "Story & Press" — the artist's approved story cards, at the bottom of
 * the page. Client-fetched so owner approvals surface without a deploy;
 * hides entirely (no section, no header) when the artist has no cards.
 */
export function StorySection({ slug, artistName }: StorySectionProps) {
  const [state, setState] = useState<SectionState>({ status: 'loading' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/stories/${encodeURIComponent(slug)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { cards?: StoryCard[] }
        if (!cancelled) {
          setState(
            body.cards && body.cards.length > 0
              ? { status: 'ready', cards: body.cards }
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
  }, [slug])

  if (state.status !== 'ready') return null

  return (
    <section
      id="story-cards"
      className="section"
      aria-labelledby="story-cards-heading"
    >
      <div className="container">
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span id="story-cards-heading" className={styles.heading}>
            Story &amp; Press
          </span>
          <span className={styles.count}>
            {state.cards.length} {state.cards.length === 1 ? 'story' : 'stories'}{' '}
            {open ? '▾' : '▸'}
          </span>
        </button>
        {open && (
          <div className={styles.cards}>
            {state.cards.map((card) => (
              <StoryCardView key={card.id} card={card} />
            ))}
            <p className={styles.note}>
              Short features on {artistName}, written from published sources —
              every card lists them.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
