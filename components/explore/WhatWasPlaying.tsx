'use client'

import { useEffect, useState } from 'react'
import { youtubeSearchUrl } from '@/lib/explore/panelData'
import type { PlayingEntry } from '@/lib/explore/playing'
import { listenSearch } from '@/lib/links'
import styles from './WhatWasPlaying.module.css'

interface WhatWasPlayingProps {
  countryCode: string
  countryName: string
  yearStart: number
  yearEnd: number
}

type PlayingState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; entry: PlayingEntry }

/** Split "[[Toots Hibbert]] ruled…" into text and linkable segments. */
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

async function fetchPlaying(
  country: string,
  yearStart: number,
  yearEnd: number,
  signal: AbortSignal,
): Promise<PlayingEntry | null> {
  const span =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}-${yearEnd}`
  const res = await fetch(`/api/explore/playing/${country}/${span}`, {
    signal,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Could not load the era snapshot.')
  return res.json()
}

/**
 * The primary panel block: what was actually shaping the culture in
 * this country and era — chart-anchored where a national chart archive
 * exists, documented touchstones where none does. Honest-sparse:
 * uncovered combos show a small note, never invented hits.
 */
export function WhatWasPlaying({
  countryCode,
  countryName,
  yearStart,
  yearEnd,
}: WhatWasPlayingProps) {
  const [state, setState] = useState<PlayingState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchPlaying(countryCode, yearStart, yearEnd, controller.signal)
      .then((entry) =>
        setState(entry ? { status: 'ready', entry } : { status: 'none' }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'none' })
      })
    return () => controller.abort()
  }, [countryCode, yearStart, yearEnd])

  if (state.status === 'loading') {
    return (
      <div className={styles.shimmerBlock} aria-hidden="true">
        <span className={styles.shimmer} />
        <span className={`${styles.shimmer} ${styles.shimmerShort}`} />
      </div>
    )
  }

  if (state.status === 'none') {
    return (
      <p className={styles.noSnapshot}>
        No documented snapshot of what was playing here in this era yet —
        these are gathered over time, from real sources only.
      </p>
    )
  }

  const { entry } = state
  const eraLabel =
    entry.from === entry.to ? `${entry.from}` : `${entry.from}–${entry.to}`

  return (
    <section
      className={styles.section}
      aria-label={`What was playing in ${countryName}, ${eraLabel}`}
    >
      <h3 className={styles.heading}>
        What was playing — {entry.era}
        <span className={styles.eraSpan}> · {eraLabel}</span>
      </h3>

      <p className={styles.story}>
        {segments(entry.story).map((segment, index) =>
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

      <ul className={styles.items}>
        {entry.items.map((item) => (
          <li key={`${item.artist}:${item.work}`} className={styles.item}>
            <div className={styles.itemText}>
              <a
                className={styles.itemWork}
                href={listenSearch(item.artist, item.work)}
                target="_blank"
                rel="noreferrer"
              >
                {item.work}
              </a>
              <span className={styles.itemMeta}>
                {item.artist}
                {item.note ? ` · ${item.note}` : ''}
              </span>
            </div>
            <a
              className={styles.listenLink}
              href={listenSearch(item.artist, item.work)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Listen: search YouTube for ${item.work} by ${item.artist}`}
            >
              ▶ Listen
            </a>
          </li>
        ))}
      </ul>

      <p className={styles.basis}>{entry.basis}</p>
      {entry.sources.length > 0 && (
        <p className={styles.sources}>
          Sources:{' '}
          {entry.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 && ' · '}
              <a
                className={styles.sourceLink}
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
