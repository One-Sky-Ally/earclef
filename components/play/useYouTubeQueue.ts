'use client'

import { useEffect, useRef, useState } from 'react'
import { loadYouTubeApi, type YtPlayer } from '@/lib/play/youtubeApi'

/**
 * One visible YouTube player walking a list of verified videos: play
 * any row, play from the top, pause/resume the current row, advance at
 * the end of each video, and skip (and mark) a video that died since it
 * was verified. Unmounting the owner destroys the player — one sound at
 * a time, never a hidden player.
 *
 * Shared by the curated journey, an artist's "Start here" and the video
 * explorer. Render `mountRef` on a positioned element where the player
 * should appear.
 */
export function useYouTubeQueue(videoIds: string[]) {
  // The playing video, by id: a list re-filtered mid-song (the video
  // explorer) keeps the right row lit and moves on from the right place.
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [dead, setDead] = useState<ReadonlySet<string>>(new Set())
  const [ended, setEnded] = useState(false)
  const [paused, setPaused] = useState(false)
  const [broken, setBroken] = useState(false)
  const mountRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const deadRef = useRef<Set<string>>(new Set())
  const idsRef = useRef<string[]>(videoIds)
  const disposedRef = useRef(false)
  // The player exists but isn't ready yet (or is still being built):
  // a click in that window queues its song instead of calling into a
  // half-made player or building a second one.
  const readyRef = useRef(false)
  const creatingRef = useRef(false)
  const queuedRef = useRef<string | null>(null)

  // Player callbacks read the list through a ref — synced after render.
  useEffect(() => {
    idsRef.current = videoIds
  })

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      playerRef.current?.destroy()
      playerRef.current = null
      readyRef.current = false
    }
  }, [])

  function nextPlayable(from: number): number {
    const list = idsRef.current
    for (let index = from; index < list.length; index++) {
      if (!deadRef.current.has(list[index])) return index
    }
    return -1
  }

  function advance() {
    const at = currentIdRef.current ? idsRef.current.indexOf(currentIdRef.current) : -1
    const next = nextPlayable(at + 1)
    if (next >= 0) void playAt(next)
    else setEnded(true)
  }

  async function playAt(index: number) {
    const videoId = idsRef.current[index]
    if (!videoId) return
    currentIdRef.current = videoId
    setCurrentId(videoId)
    setEnded(false)
    if (playerRef.current && readyRef.current) {
      playerRef.current.loadVideoById(videoId)
      return
    }
    if (creatingRef.current || playerRef.current) {
      queuedRef.current = videoId
      return
    }
    creatingRef.current = true
    try {
      const yt = await loadYouTubeApi()
      if (disposedRef.current || !mountRef.current) return
      const target = document.createElement('div')
      mountRef.current.replaceChildren(target)
      playerRef.current = new yt.Player(target, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (event) => {
            readyRef.current = true
            const queued = queuedRef.current
            queuedRef.current = null
            if (queued && queued !== videoId) {
              playerRef.current?.loadVideoById(queued)
            } else {
              event.target.playVideo()
            }
          },
          onStateChange: (event) => {
            if (event.data === yt.PlayerState.ENDED) advance()
            else if (event.data === yt.PlayerState.PLAYING) setPaused(false)
            else if (event.data === yt.PlayerState.PAUSED) setPaused(true)
          },
          // A video that died since it was verified is skipped, and its
          // row says so — never a stalled queue.
          onError: () => {
            const failed = currentIdRef.current
            if (failed) {
              deadRef.current = new Set([...deadRef.current, failed])
              setDead(deadRef.current)
            }
            advance()
          },
        },
      })
    } catch {
      setBroken(true)
    } finally {
      creatingRef.current = false
    }
  }

  /** The current row's button pauses and resumes; any other row plays. */
  function toggleOrPlay(index: number) {
    const player = playerRef.current
    if (
      idsRef.current[index] === currentIdRef.current &&
      player &&
      readyRef.current &&
      !ended
    ) {
      if (paused) player.playVideo?.()
      else player.pauseVideo()
      return
    }
    void playAt(index)
  }

  function playAll() {
    const first = nextPlayable(0)
    if (first >= 0) void playAt(first)
  }

  // Where the playing video sits in the list as it is now (or null).
  const at = currentId ? videoIds.indexOf(currentId) : -1
  const current = at >= 0 ? at : null

  return {
    mountRef,
    current,
    currentId,
    ended,
    paused,
    broken,
    dead,
    playAt,
    toggleOrPlay,
    playAll,
  }
}
