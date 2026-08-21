'use client'

import { useEffect, useState } from 'react'
import { QueuePlayer } from '@/components/explore/QueuePlayer'
import styles from './HitsSection.module.css'

/**
 * This year's #1 hits — strict-sourcing gate (Gate v3 Tier 1): the
 * section exists ONLY where an authoritative chart covers the place
 * and era (Billboard Hot 100, OCC Official Singles Chart). The API
 * 404s everywhere else and this renders nothing — no inferred charts,
 * ever. ▶ appears per hit only once the verification sweep has a
 * playability-checked video for it; "Play all" queues exactly those.
 */

interface HitEntry {
  title: string
  artist: string
  first: string
  weeks: number
  videoId: string | null
}

interface HitsPayload {
  chartName: string
  attribution: string
  total: number
  capped: boolean
  entries: HitEntry[]
}

interface HitsSectionProps {
  countryCode: string
  countryName: string
  yearStart: number
  yearEnd: number
}

type HitsState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; payload: HitsPayload }

const TIER_BASE = 5
const TIER_STEP = 20

async function fetchHits(
  country: string,
  yearStart: number,
  yearEnd: number,
  signal: AbortSignal,
): Promise<HitsPayload | null> {
  const span =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}-${yearEnd}`
  const res = await fetch(`/api/hits/${country}/${span}`, { signal })
  if (!res.ok) return null
  return res.json()
}

export function HitsSection({
  countryCode,
  countryName,
  yearStart,
  yearEnd,
}: HitsSectionProps) {
  const [state, setState] = useState<HitsState>({ status: 'loading' })
  const [visible, setVisible] = useState(TIER_BASE)

  useEffect(() => {
    const controller = new AbortController()
    fetchHits(countryCode, yearStart, yearEnd, controller.signal)
      .then((payload) =>
        setState(payload ? { status: 'ready', payload } : { status: 'none' }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'none' })
      })
    return () => controller.abort()
  }, [countryCode, yearStart, yearEnd])

  // Loading is silent: most places have no chart section at all, and a
  // shimmer that usually vanishes into nothing reads as a glitch.
  if (state.status !== 'ready') return null

  const { payload } = state
  const shown = payload.entries.slice(0, visible)
  const spanLabel =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}–${yearEnd}`
  const heading =
    yearStart === yearEnd
      ? `${yearStart}’s #1 hits in ${countryName}`
      : `#1 hits in ${countryName}, ${spanLabel}`
  const playable = payload.entries
    .filter((entry) => entry.videoId)
    .map((entry) => ({
      videoId: entry.videoId as string,
      title: entry.title,
      artistName: entry.artist,
      mbid: '',
    }))

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>{heading}</h3>

      {playable.length > 0 && (
        <QueuePlayer
          key={`hits:${countryCode}:${spanLabel}`}
          placeName={countryName}
          year={yearStart}
          pool={[]}
          roster={{}}
          preresolved={playable}
          buttonLabel={`▶ Play all — the #1s of ${spanLabel}`}
        />
      )}

      <ol className={styles.list}>
        {shown.map((entry, index) => (
          <li key={`${entry.artist}:${entry.title}:${entry.first}`} className={styles.row}>
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.what}>
              <span className={styles.title}>“{entry.title}”</span>
              <span className={styles.artist}>{entry.artist}</span>
            </span>
            <span className={styles.side}>
              <span className={styles.weeks}>
                {entry.weeks} wk{entry.weeks === 1 ? '' : 's'} at №1
              </span>
              {entry.videoId && (
                <a
                  className={styles.playBadge}
                  href={`https://www.youtube.com/watch?v=${entry.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Play “${entry.title}” by ${entry.artist} on YouTube`}
                >
                  ▶
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>

      {visible < payload.entries.length && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setVisible((count) => count + TIER_STEP)}
        >
          Show {Math.min(TIER_STEP, payload.entries.length - visible)} more ↓
        </button>
      )}
      {payload.capped && visible >= payload.entries.length && (
        <p className={styles.capNote}>
          Top {payload.entries.length} of {payload.total} shown — narrow the
          years for the full list.
        </p>
      )}

      <p className={styles.attribution}>{payload.attribution}</p>
    </div>
  )
}
