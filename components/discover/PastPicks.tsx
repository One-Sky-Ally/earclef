'use client'

import { useEffect, useState } from 'react'
import { YouTubeEmbed } from '@/components/YouTubeEmbed'
import { LikeButton } from '@/components/fans/LikeButton'
import { FollowButton } from '@/components/fans/FollowButton'
import { getOwnerKey } from '@/lib/curation/ownerClient'
import { markPlayed, unmarkPlayed, type PlayedMark } from '@/lib/discover/played'
import { usePlayedMarks } from './usePlayedMarks'
import styles from './PastPicks.module.css'

/** One past pick as the route sends it (lib/discover/past.ts PastPick). */
interface PastArtist {
  pick: {
    name: string
    why: string
    mbid: string
    song: { videoId: string; title: string } | null
    bandcamp: string | null
  }
  lastDate: string
  firstDate: string
  sources: ('own' | 'shared')[]
  /** Set once the artist has an Ear Clef page: Follow follows the page. */
  slug?: string
}

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

function bandcampOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    return parsed.protocol === 'https:' && (host === 'bandcamp.com' || host.endsWith('.bandcamp.com'))
      ? url
      : null
  } catch {
    return null
  }
}

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

function markLabel(mark: PlayedMark): string {
  return mark.how === 'hand' ? `Marked as played ${dayLabel(mark.on)}` : `Played ${dayLabel(mark.on)}`
}

export function PastPicks() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; since: string | null; artists: PastArtist[] }
  >({ status: 'loading' })
  const [filter, setFilter] = useState<Filter>('all')
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
  const shown = filter === 'played' ? played : filter === 'not-yet' ? notYet : state.artists
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
            onClick={() => setFilter(option.id)}
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

      {shown.length === 0 ? (
        <p className={styles.quiet}>
          {filter === 'played' ? 'Nothing played yet.' : 'You’ve played every past pick.'}
        </p>
      ) : (
        <ul className={styles.grid}>
          {shown.map(({ pick, lastDate, firstDate, sources, slug: rawSlug }) => {
            const slug = typeof rawSlug === 'string' && /^[a-z0-9-]+$/.test(rawSlug) ? rawSlug : undefined
            const mark = marks[pick.mbid]
            const bandcamp = bandcampOf(pick.bandcamp)
            return (
              <li key={pick.mbid} className={styles.card} data-played={mark ? 'true' : undefined}>
                <div className={styles.top}>
                  <span className={styles.name}>{pick.name}</span>
                  <span className={mark ? styles.markPlayed : styles.markNotYet}>
                    {mark ? `✓ ${markLabel(mark)}` : 'Not played yet'}
                  </span>
                </div>
                <span className={styles.when}>
                  Recommended {dayLabel(lastDate)}
                  {firstDate !== lastDate && ` (first ${dayLabel(firstDate)})`}
                  {sources.includes('own') && ' · in your own picks'}
                </span>
                {pick.why && <span className={styles.why}>{pick.why}</span>}
                {pick.song && (
                  <YouTubeEmbed
                    video={{ youtubeId: pick.song.videoId, title: pick.song.title }}
                    onPlay={() => markPlayed(pick.mbid)}
                  />
                )}
                {/* The same Follow as every artist page (Nov 28 2026). */}
                {slug ? (
                  <FollowButton artistName={pick.name} slug={slug} inline />
                ) : (
                  <FollowButton
                    artistName={pick.name}
                    mbid={pick.mbid}
                    videoId={pick.song?.videoId}
                    signInDest="/discover/past"
                    inline
                  />
                )}
                <div className={styles.actions}>
                  {pick.song && (
                    <LikeButton
                      variant="row"
                      track={{
                        videoId: pick.song.videoId,
                        title: pick.song.title,
                        artistName: pick.name,
                        mbid: pick.mbid,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => (mark ? unmarkPlayed(pick.mbid) : markPlayed(pick.mbid, 'hand'))}
                  >
                    {mark ? 'Mark as not played' : 'Mark as played'}
                  </button>
                  {bandcamp && (
                    <a className={styles.link} href={bandcamp} target="_blank" rel="noreferrer">
                      Bandcamp ↗
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
