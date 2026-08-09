'use client'

import { useEffect, useState } from 'react'
import type { PlayingEntry } from '@/lib/explore/playing'
import {
  musicServiceSearchUrl,
  resolveListenHref,
} from '@/lib/listen/services'
import { useListenService } from '@/components/listen/ServiceProvider'
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
  const { service } = useListenService()
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
            // Artist mentions carry no verified id, so they search a
            // MUSIC service (empty miss), never YouTube (garbage miss).
            <a
              key={index}
              className={styles.artistLink}
              href={musicServiceSearchUrl('appleMusic', segment.text)}
              title={`Search on Apple Music: ${segment.text}`}
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
        {entry.items.map((item) => {
          const listen = resolveListenHref(
            service,
            undefined,
            item.artist,
            item.work,
          )
          return (
            <li key={`${item.artist}:${item.work}`} className={styles.item}>
              <div className={styles.itemText}>
                <a
                  className={styles.itemWork}
                  href={listen.href}
                  title={`${listen.label}: ${item.work}`}
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
                href={listen.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`${listen.label}: ${item.work} by ${item.artist}`}
              >
                {listen.label} ↗
              </a>
            </li>
          )
        })}
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
