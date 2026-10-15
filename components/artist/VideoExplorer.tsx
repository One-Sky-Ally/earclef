'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchVideos, type VideosResponse } from '@/lib/artist/browserData'
import type { VideoRef } from '@/lib/types'
import { youtubeThumb } from '@/lib/play/youtubeApi'
import { useYouTubeQueue } from '@/components/play/useYouTubeQueue'
import { Icon } from '@/components/ui/Icon'
import { LikeButton } from '@/components/fans/LikeButton'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './VideoExplorer.module.css'

/**
 * The video explorer, "From the artist": the videos hand-picked for the
 * page plus the uploads on the artist's own YouTube channel, in the
 * channel's existing groups (main releases, live, interviews, other).
 * Search, type and sort work on what is really there; dates are UPLOAD
 * dates and are labelled as such. One player: choosing a video plays it
 * at the top and carries on through the list as filtered.
 */

type Kind = 'pick' | 'main' | 'live' | 'interviews' | 'other'
type Sort = 'recommended' | 'newest' | 'oldest'

const KIND_LABELS: Record<Kind, string> = {
  pick: 'Ear Clef picks',
  main: 'Music videos & audio',
  live: 'Live performances',
  interviews: 'Interviews',
  other: 'Other uploads',
}

const SORT_LABELS: Record<Sort, string> = {
  recommended: 'Recommended',
  newest: 'Newest uploads',
  oldest: 'Oldest uploads',
}

const VIDEO_ID = /^[\w-]{11}$/
const FIRST_CARDS = 9

interface ExplorerVideo {
  videoId: string
  title: string
  kind: Kind
  publishedAt?: string
  /** Position in the recommended order: picks, then the channel's own. */
  rank: number
}

type ChannelState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; videos: VideosResponse }

/** Kinds that are songs: interviews and other uploads get no ♥. */
const SONG_KINDS: ReadonlySet<Kind> = new Set(['pick', 'main', 'live'])

interface VideoExplorerProps {
  artistName: string
  /** MusicBrainz id, so a saved song can count toward the listener's radar. */
  mbid?: string
  picks: VideoRef[]
  channelId?: string
  channelUrl?: string
}

function uploadDate(iso?: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function VideoExplorer({
  artistName,
  mbid,
  picks,
  channelId,
  channelUrl,
}: VideoExplorerProps) {
  const [channel, setChannel] = useState<ChannelState>(
    channelId ? { status: 'loading' } : { status: 'none' },
  )
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [sort, setSort] = useState<Sort>('recommended')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!channelId) return
    const controller = new AbortController()
    fetchVideos(channelId, controller.signal)
      .then((videos) => setChannel({ status: 'ready', videos }))
      .catch(() => {
        if (!controller.signal.aborted) setChannel({ status: 'error' })
      })
    return () => controller.abort()
  }, [channelId])

  const all = useMemo<ExplorerVideo[]>(() => {
    const seen = new Set<string>()
    const list: ExplorerVideo[] = []
    for (const pick of picks) {
      if (!VIDEO_ID.test(pick.youtubeId) || seen.has(pick.youtubeId)) continue
      seen.add(pick.youtubeId)
      list.push({ videoId: pick.youtubeId, title: pick.title, kind: 'pick', rank: list.length })
    }
    if (channel.status === 'ready') {
      for (const category of channel.videos.categories) {
        const categoryKind = (
          ['main', 'live', 'interviews', 'other'] as const
        ).find((key) => key === category.key)
        if (!categoryKind) continue
        for (const video of category.items) {
          if (!VIDEO_ID.test(video.videoId) || seen.has(video.videoId)) continue
          seen.add(video.videoId)
          list.push({
            videoId: video.videoId,
            title: video.title,
            kind: categoryKind,
            publishedAt: video.publishedAt,
            rank: list.length,
          })
        }
      }
    }
    return list
  }, [picks, channel])

  const kinds = (Object.keys(KIND_LABELS) as Kind[]).filter((key) =>
    all.some((video) => video.kind === key),
  )
  const visibleList = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const filtered = all.filter(
      (video) =>
        (kind === 'all' || video.kind === kind) &&
        (!needle || video.title.toLocaleLowerCase().includes(needle)),
    )
    if (sort === 'recommended') return filtered
    // Videos without an upload date (hand-picked ones) go last.
    return [...filtered].sort((a, b) => {
      if (!a.publishedAt || !b.publishedAt) {
        return a.publishedAt ? -1 : b.publishedAt ? 1 : a.rank - b.rank
      }
      return sort === 'newest'
        ? b.publishedAt.localeCompare(a.publishedAt)
        : a.publishedAt.localeCompare(b.publishedAt)
    })
  }, [all, kind, query, sort])

  const { mountRef, current, ended, paused, broken, toggleOrPlay, playAll } = useYouTubeQueue(
    visibleList.map((video) => video.videoId),
  )
  const playing = current !== null ? visibleList[current] : null
  const first = visibleList[0] ?? all[0]
  const shown = showAll ? visibleList : visibleList.slice(0, FIRST_CARDS)

  if (all.length === 0 && channel.status !== 'loading') return null

  return (
    <div className={styles.explorer}>
      <div className={styles.toolbar}>
        <p className={styles.view}>From the artist</p>
        <div className={styles.controls}>
          <label className={styles.search}>
            <Icon name="search" size={16} />
            <span className="visually-hidden">Search {artistName} videos</span>
            <input
              type="search"
              placeholder={`Search ${artistName} videos…`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setShowAll(false)
              }}
            />
          </label>
          <label className={styles.control}>
            <span className="visually-hidden">Type</span>
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Kind | 'all')
                setShowAll(false)
              }}
            >
              <option value="all">All types ({all.length})</option>
              {kinds.map((key) => (
                <option key={key} value={key}>
                  {KIND_LABELS[key]} ({all.filter((video) => video.kind === key).length})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.control}>
            <span className="visually-hidden">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {first && (
        <div className={styles.stage}>
          <div className={styles.player}>
            <div ref={mountRef} className={styles.frame} />
            {current === null && (
              <button
                type="button"
                className={styles.facade}
                onClick={playAll}
                aria-label={`Play ${first.title}`}
              >
                <SafeImage className={styles.still} src={youtubeThumb(first.videoId)} />
                <span className={styles.facadePlay} aria-hidden="true">
                  <Icon name="play" size={26} />
                </span>
              </button>
            )}
          </div>
          <div className={styles.nowText} aria-live="polite">
            <div className={styles.nowRow}>
              <p className={styles.nowTitle}>{playing ? playing.title : first.title}</p>
              {playing && !ended && SONG_KINDS.has(playing.kind) && (
                <LikeButton
                  track={{
                    videoId: playing.videoId,
                    title: playing.title,
                    artistName,
                    ...(mbid ? { mbid } : {}),
                  }}
                />
              )}
            </div>
            <p className={styles.nowMeta}>
              {playing && ended
                ? 'That’s every video in this list.'
                : KIND_LABELS[(playing ?? first).kind]}
            </p>
            {broken && playing && (
              <a
                className={styles.fallback}
                href={`https://www.youtube.com/watch?v=${playing.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                The player didn’t load — watch on YouTube ↗
              </a>
            )}
          </div>
        </div>
      )}

      {channel.status === 'loading' && (
        <p className={styles.note}>Gathering the channel’s uploads…</p>
      )}
      {channel.status === 'error' && (
        <p className={styles.note}>
          The channel’s uploads didn’t load right now — showing the hand-picked videos.
        </p>
      )}

      {visibleList.length === 0 ? (
        <p className={styles.note}>No video matches that search.</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((video, index) => {
            const isCurrent = index === current && !ended
            const date = uploadDate(video.publishedAt)
            return (
              <li key={video.videoId}>
                <button
                  type="button"
                  className={`${styles.card} ${isCurrent ? styles.cardCurrent : ''}`}
                  onClick={() => toggleOrPlay(index)}
                  aria-label={`${isCurrent && !paused ? 'Pause' : 'Play'} ${video.title}`}
                >
                  <span className={styles.thumb}>
                    <SafeImage src={youtubeThumb(video.videoId, 'mq')} />
                    <span className={styles.thumbPlay} aria-hidden="true">
                      <Icon name={isCurrent && !paused ? 'pause' : 'play'} size={16} />
                    </span>
                  </span>
                  <span className={styles.cardTitle}>{video.title}</span>
                  <span className={styles.cardMeta}>
                    {KIND_LABELS[video.kind]}
                    {date ? ` · uploaded ${date}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className={styles.footer}>
        {visibleList.length > FIRST_CARDS && (
          <button
            type="button"
            className={styles.more}
            onClick={() => setShowAll((open) => !open)}
            aria-expanded={showAll}
          >
            {showAll ? 'Show fewer' : `Show all ${visibleList.length}`}
          </button>
        )}
        {channelUrl && (
          <a className={styles.channel} href={channelUrl} target="_blank" rel="noreferrer">
            {artistName} on YouTube ↗
          </a>
        )}
      </div>
    </div>
  )
}
