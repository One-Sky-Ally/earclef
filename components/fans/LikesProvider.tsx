'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { unionLikes, type LikedTrack } from '@/lib/fans/likes'
import { readStoredLikes, writeStoredLikes } from '@/lib/fans/likesStorage'

/** A like as the player knows it — the timestamp is ours to stamp. */
export type LikeDraft = Omit<LikedTrack, 'likedAt'>

interface LikesContextValue {
  likes: LikedTrack[]
  /** False until the stored likes have been read — ♥ states wait for it. */
  ready: boolean
  isLiked: (videoId: string) => boolean
  toggleLike: (draft: LikeDraft) => void
  /** The shelf is full: the last like was refused, nothing was dropped. */
  atCapacity: boolean
  dismissCapacity: () => void
}

const LikesContext = createContext<LikesContextValue>({
  likes: [],
  ready: false,
  isLiked: () => false,
  toggleLike: () => {},
  atCapacity: false,
  dismissCapacity: () => {},
})

async function postLike(body: unknown): Promise<{ atCapacity?: boolean }> {
  try {
    const res = await fetch('/api/fan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    // 401 is not a failure here — it just means nobody is signed in, and
    // the browser copy is the whole story until they are.
    if (!res.ok) return {}
    return (await res.json()) as { atCapacity?: boolean }
  } catch {
    return {}
  }
}

/**
 * Liked songs, site-wide. Local-first by construction: the ♥ writes to
 * this browser immediately and posts to the fan record in the
 * background, so liking a song never waits on a round trip and never
 * requires signing in first. A signed-in fan sees their server likes
 * unioned with anything this browser saved while signed out — those
 * stay visible until the sign-in merge folds them in for good.
 */
export function LikesProvider({ children }: { children: React.ReactNode }) {
  const [likes, setLikes] = useState<LikedTrack[]>([])
  const [ready, setReady] = useState(false)
  const [atCapacity, setAtCapacity] = useState(false)
  // The list the writers read, without making every callback depend on
  // it (and so re-subscribe every ♥).
  const likesRef = useRef<LikedTrack[]>([])

  const commit = useCallback((next: LikedTrack[]) => {
    likesRef.current = next
    setLikes(next)
    writeStoredLikes(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = readStoredLikes()
      let next = local
      try {
        // Bounded: a hung profile request must not leave every ♥
        // disabled — the browser's own likes are answer enough.
        const res = await fetch('/api/fan', {
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const body = (await res.json()) as {
            signedIn: boolean
            likes?: LikedTrack[]
          }
          if (body.signedIn && Array.isArray(body.likes)) {
            // The server's copy wins a collision: it holds the context
            // the song was FIRST liked in.
            next = unionLikes(body.likes, local)
          }
        }
      } catch {
        // The browser copy carries it.
      }
      if (cancelled) return
      likesRef.current = next
      setLikes(next)
      writeStoredLikes(next)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const isLiked = useCallback(
    (videoId: string) =>
      likes.some((track) => track.videoId === videoId),
    [likes],
  )

  const toggleLike = useCallback(
    (draft: LikeDraft) => {
      const current = likesRef.current
      const saved = current.find((track) => track.videoId === draft.videoId)

      if (saved) {
        commit(current.filter((track) => track.videoId !== draft.videoId))
        void postLike({ unlike: draft.videoId })
        return
      }

      const track: LikedTrack = { ...draft, likedAt: new Date().toISOString() }
      commit([track, ...current])
      void postLike({ like: track }).then((result) => {
        // A full shelf on the server refuses the save. Take the ♥ back
        // rather than showing a like that is not really there.
        if (!result.atCapacity) return
        setAtCapacity(true)
        const reverted = likesRef.current.filter(
          (entry) => entry.videoId !== draft.videoId,
        )
        commit(reverted)
      })
    },
    [commit],
  )

  const dismissCapacity = useCallback(() => setAtCapacity(false), [])

  return (
    <LikesContext.Provider
      value={{ likes, ready, isLiked, toggleLike, atCapacity, dismissCapacity }}
    >
      {children}
    </LikesContext.Provider>
  )
}

export function useLikes(): LikesContextValue {
  return useContext(LikesContext)
}
