'use client'

import { useEffect, useState } from 'react'
import { ShufflePicks, type ShuffleTrack } from './ShufflePicks'
import { PastPickCard, dayLabel, type PastArtist } from './PastPickCard'
import { getOwnerKey } from '@/lib/curation/ownerClient'
import { usePlayedMarks } from './usePlayedMarks'
import styles from './PastPicks.module.css'

interface PastBody {
  status: 'ready'
  since: string | null
  artists: PastArtist[]
}

type Filter = 'all' | 'not-yet' | 'played'

const VIDEO_ID = /^[\w-]{11}$/
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Stored output outlives its code: only well-formed entries render. */
function usable(entry: Partial<PastArtist>): entry is PastArtist {
  const pick = entry?.pick
  return Boolean(
    pick &&
      typeof pick.name === 'string' &&
      typeof pick.mbid === 'string' &&
      MBID.test(pick.mbid) &&
      typeof pick.song?.videoId === 'string' &&
      VIDEO_ID.test(pick.song.videoId) &&
      typeof entry.lastDate === 'string',
  )
}

export function PastPicks() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; since: string | null; artists: PastArtist[] }
  >({ status: 'loading' })
  const [filter, setFilter] = useState<Filter>('all')
  // A filter keeps the cards it showed when chosen: pressing ▶ under "Not
  // played yet" marks the artist, and the card (and its player) must not
  // vanish mid-song. Choosing the filter again refreshes it.
  const [kept, setKept] = useState<ReadonlySet<string> | null>(null)
  const { marks, ready } = usePlayedMarks()

  useEffect(() => {
    const controller = new AbortController()
    const key = getOwnerKey()
    // The owner also sees their own sets; ?own=1 keeps that answer out of the CDN's public copy.
    fetch(key ? '/api/discover/past?own=1' : '/api/discover/past', {
      signal: controller.signal,
      headers: key ? { 'x-owner-key': key } : undefined,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<PastBody>
      })
      .then((body) =>
        setState({
          status: 'ready',
          since: typeof body.since === 'string' ? body.since : null,
          artists: Array.isArray(body.artists) ? body.artists.filter(usable) : [],
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [])

  if (state.status === 'loading') return <p className={styles.quiet}>Gathering past picks…</p>
  if (state.status === 'error') {
    return <p className={styles.quiet}>Past picks couldn&rsquo;t load just now. Try again in a moment.</p>
  }
  if (state.artists.length === 0) {
    return <p className={styles.quiet}>No past picks yet — they appear here once Discover has shown some.</p>
  }

  const played = state.artists.filter((artist) => marks[artist.pick.mbid])
  const notYet = state.artists.filter((artist) => !marks[artist.pick.mbid])
  const shown = filter === 'all' || !kept ? state.artists : state.artists.filter((artist) => kept.has(artist.pick.mbid))
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: state.artists.length },
    { id: 'not-yet', label: 'Not played yet', count: notYet.length },
    { id: 'played', label: 'Played', count: played.length },
  ]

  return (
    <>
      <div className={styles.filters} role="group" aria-label="Show">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            className={styles.filter}
            aria-pressed={filter === option.id}
            onClick={() => {
              setFilter(option.id)
              const chosen = option.id === 'played' ? played : option.id === 'not-yet' ? notYet : null
              setKept(chosen ? new Set(chosen.map((artist) => artist.pick.mbid)) : null)
            }}
          >
            {option.label} <span className={styles.count}>{ready ? option.count : '…'}</span>
          </button>
        ))}
      </div>
      {state.since && (
        <p className={styles.since}>
          Going back to {dayLabel(state.since)}. Plays from before 23 Nov weren&rsquo;t remembered,
          so mark any you&rsquo;ve already heard.
        </p>
      )}

      {/* Shuffles what the filter shows: every past pick by default. */}
      <ShufflePicks
        tracks={shown.flatMap(({ pick, slug }): ShuffleTrack[] =>
          pick.song
            ? [
                {
                  videoId: pick.song.videoId,
                  title: pick.song.title,
                  artistName: pick.name,
                  mbid: pick.mbid,
                  ...(typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug) ? { slug } : {}),
                },
              ]
            : [],
        )}
        label={
          filter === 'all'
            ? `Shuffle all ${shown.length} past picks`
            : filter === 'not-yet'
              ? `Shuffle the ${shown.length} not played yet`
              : `Shuffle the ${shown.length} played`
        }
      />

      {shown.length === 0 ? (
        <p className={styles.quiet}>
          {filter === 'played' ? 'Nothing played yet.' : 'You’ve played every past pick.'}
        </p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((entry) => (
            <PastPickCard key={entry.pick.mbid} entry={entry} mark={marks[entry.pick.mbid]} />
          ))}
        </ul>
      )}
    </>
  )
}
