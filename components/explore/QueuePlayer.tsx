'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { PoolArtist } from '@/lib/explore/panelData'
import type { RosterByMbid } from './CountryPanel'
import styles from './QueuePlayer.module.css'

/**
 * Place+era play queue — discovery ends in sound. One tap builds a
 * queue from the panel's popularity pool: each artist resolves to an
 * era-correct verified video via /api/queue (hybrid lazy cache —
 * first build pays, everyone after plays instantly). Track 1 starts
 * the moment it resolves; the rest keep arriving while it plays.
 * Playback stays in the visible YouTube iframe player, the universal
 * free player everywhere else on the site.
 */

const QUEUE_MAX = 40
/** Below this many playable tracks, say so — never pad the queue. */
const HONEST_MIN = 5

interface ResolvedTrack {
  videoId: string
  title: string
  artistName: string
  mbid: string
}

interface QueuePlayerProps {
  placeName: string
  year: number
  pool: PoolArtist[]
  roster: RosterByMbid
}

/** Minimal typing for the pieces of the IFrame API we drive. */
interface YtPlayer {
  loadVideoById: (videoId: string) => void
  destroy: () => void
}
interface YtNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      playerVars: Record<string, number>
      events: {
        onReady: (event: { target: { playVideo: () => void } }) => void
        onStateChange: (event: { data: number }) => void
      }
    },
  ) => YtPlayer
  PlayerState: { ENDED: number }
}

declare global {
  interface Window {
    YT?: YtNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytApiPromise: Promise<YtNamespace> | null = null

function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window !== 'undefined' && window.YT?.Player) {
    return Promise.resolve(window.YT)
  }
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      ytApiPromise = null
      reject(new Error('YouTube player failed to load'))
    }
    document.head.appendChild(script)
  })
  return ytApiPromise
}

export function QueuePlayer({
  placeName,
  year,
  pool,
  roster,
}: QueuePlayerProps) {
  const [active, setActive] = useState(false)
  const [tracks, setTracks] = useState<ResolvedTrack[]>([])
  const [current, setCurrent] = useState(0)
  const [building, setBuilding] = useState(false)
  const [done, setDone] = useState(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [playerBroken, setPlayerBroken] = useState(false)

  const playerRef = useRef<YtPlayer | null>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const firstPlayedRef = useRef(false)
  const tracksRef = useRef<ResolvedTrack[]>([])
  const currentRef = useRef(0)
  tracksRef.current = tracks
  currentRef.current = current

  useEffect(
    () => () => {
      abortRef.current?.abort()
      try {
        playerRef.current?.destroy()
      } catch {
        // Player already gone with its DOM.
      }
    },
    [],
  )

  function jumpTo(index: number) {
    const track = tracksRef.current[index]
    if (!track) return
    setCurrent(index)
    playerRef.current?.loadVideoById(track.videoId)
  }

  async function playFirst(track: ResolvedTrack) {
    try {
      const yt = await loadYouTubeApi()
      if (!mountRef.current || abortRef.current?.signal.aborted) return
      const mount = document.createElement('div')
      mountRef.current.appendChild(mount)
      playerRef.current = new yt.Player(mount, {
        videoId: track.videoId,
        playerVars: { autoplay: 1, rel: 0 },
        events: {
          onReady: (event) => event.target.playVideo(),
          onStateChange: (event) => {
            if (event.data === yt.PlayerState.ENDED) {
              jumpTo(currentRef.current + 1)
            }
          },
        },
      })
    } catch {
      setPlayerBroken(true)
    }
  }

  async function start() {
    if (active) return
    setActive(true)
    setBuilding(true)
    const controller = new AbortController()
    abortRef.current = controller
    const decade = Math.floor(year / 10) * 10

    for (const artist of pool.slice(0, QUEUE_MAX)) {
      if (controller.signal.aborted) return
      try {
        const res = await fetch(
          `/api/queue/artist/${artist.id}/${decade}?name=${encodeURIComponent(artist.name)}`,
          { signal: controller.signal },
        )
        if (res.status === 503) {
          const body = (await res.json().catch(() => ({}))) as {
            quota?: boolean
          }
          if (body.quota) {
            setQuotaHit(true)
            break
          }
          continue
        }
        if (!res.ok) continue
        const body = (await res.json()) as {
          track: { videoId: string; title: string } | null
        }
        if (body.track) {
          const resolved: ResolvedTrack = {
            videoId: body.track.videoId,
            title: body.track.title,
            artistName: artist.name,
            mbid: artist.id,
          }
          setTracks((previous) => [...previous, resolved])
          if (!firstPlayedRef.current) {
            firstPlayedRef.current = true
            void playFirst(resolved)
          }
        }
      } catch {
        if (controller.signal.aborted) return
      }
    }
    setBuilding(false)
    setDone(true)
  }

  if (pool.length === 0) return null
  if (pool.length < HONEST_MIN) {
    return (
      <p className={styles.sparseNote}>
        Too few artists on record here for a real queue — no padding, no
        fillers.
      </p>
    )
  }

  if (!active) {
    return (
      <button type="button" className={styles.playButton} onClick={start}>
        ▶ Play {placeName} {year}
      </button>
    )
  }

  const nowPlaying = tracks[current]

  return (
    <div className={styles.queueBox}>
      <div className={styles.playerFrame} ref={mountRef} />

      {nowPlaying && (
        <div className={styles.nowPlaying}>
          <span className={styles.nowIndex}>
            {current + 1}/{tracks.length}
          </span>
          <span className={styles.nowTitle}>
            {nowPlaying.artistName} — {nowPlaying.title}
          </span>
          <span className={styles.controls}>
            <button
              type="button"
              className={styles.controlButton}
              onClick={() => jumpTo(current - 1)}
              disabled={current === 0}
              aria-label="Previous track"
            >
              ⏮
            </button>
            <button
              type="button"
              className={styles.controlButton}
              onClick={() => jumpTo(current + 1)}
              disabled={current >= tracks.length - 1}
              aria-label="Next track"
            >
              ⏭
            </button>
          </span>
        </div>
      )}

      {playerBroken && (
        <p className={styles.buildNote}>
          The player would not load here — the queue below still links out.
        </p>
      )}
      {!nowPlaying && !quotaHit && (
        <p className={styles.buildNote}>
          Finding the sound of {placeName} {year}…
        </p>
      )}
      {building && nowPlaying && (
        <p className={styles.buildNote}>
          Still digging — {tracks.length} track
          {tracks.length === 1 ? '' : 's'} so far…
        </p>
      )}
      {quotaHit && tracks.length === 0 && (
        <p className={styles.sparseNote}>
          This one&rsquo;s still brewing — try again in a bit.
        </p>
      )}
      {quotaHit && tracks.length > 0 && (
        <p className={styles.buildNote}>
          Paused mid-build for today — {tracks.length} tracks for now, the
          rest arrive on a later visit.
        </p>
      )}
      {done && !quotaHit && tracks.length > 0 && tracks.length < HONEST_MIN && (
        <p className={styles.buildNote}>
          Only {tracks.length} verified track
          {tracks.length === 1 ? '' : 's'} here — honest, not padded.
        </p>
      )}

      {tracks.length > 0 && (
        <ol className={styles.queueList}>
          {tracks.map((track, index) => (
            <li
              key={`${track.videoId}:${index}`}
              className={index === current ? styles.rowActive : styles.row}
            >
              <button
                type="button"
                className={styles.rowPlay}
                onClick={() => jumpTo(index)}
                aria-label={`Play ${track.artistName}`}
              >
                {index === current ? '▶' : index + 1}
              </button>
              {roster[track.mbid] ? (
                <Link
                  className={styles.rowArtistLink}
                  href={`/${roster[track.mbid].slug}`}
                >
                  {track.artistName}
                </Link>
              ) : (
                <span className={styles.rowArtist}>{track.artistName}</span>
              )}
              <span className={styles.rowTitle}>{track.title}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
