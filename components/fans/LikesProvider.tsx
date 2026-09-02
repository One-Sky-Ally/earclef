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
import {
  readPendingLikes,
  readStoredLikes,
  writePendingLikes,
  writeStoredLikes,
} from '@/lib/fans/likesStorage'

/** A like as the player knows it — the timestamp is ours to stamp. */
export type LikeDraft = Omit<LikedTrack, 'likedAt'>

interface LikesContextValue {
  likes: LikedTrack[]
  /** False until the stored likes have been read — ♥ states wait for it. */
  ready: boolean
  /** Whether these likes have anywhere to live beyond this browser. */
  signedIn: boolean
  isLiked: (videoId: string) => boolean
  toggleLike: (draft: LikeDraft) => void
  /** The shelf is full: the last like was refused, nothing was dropped. */
  atCapacity: boolean
  dismissCapacity: () => void
}

const LikesContext = createContext<LikesContextValue>({
  likes: [],
  ready: false,
  signedIn: false,
  isLiked: () => false,
  toggleLike: () => {},
  atCapacity: false,
  dismissCapacity: () => {},
})

interface FanPostResult {
  /** The fan record accepted the change — the like is durable now. */
  ok: boolean
  atCapacity?: boolean
  likes?: LikedTrack[]
  skipped?: number
}

async function postFan(body: unknown): Promise<FanPostResult> {
  try {
    const res = await fetch('/api/fan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    // 401 is not a failure here — it just means nobody is signed in, and
    // the browser copy is the whole story until they are. It IS, though,
    // a reason to keep the like pending.
    if (!res.ok) return { ok: false }
    const payload = (await res.json()) as {
      atCapacity?: boolean
      likes?: LikedTrack[]
      skipped?: number
    }
    return { ok: true, ...payload }
  } catch {
    return { ok: false }
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
  const [signedIn, setSignedIn] = useState(false)
  const [atCapacity, setAtCapacity] = useState(false)
  // The lists the writers read, without making every callback depend on
  // them (and so re-subscribe every ♥).
  const likesRef = useRef<LikedTrack[]>([])
  const pendingRef = useRef<LikedTrack[]>([])

  const commit = useCallback((next: LikedTrack[]) => {
    likesRef.current = next
    setLikes(next)
    writeStoredLikes(next)
  }, [])

  const commitPending = useCallback((next: LikedTrack[]) => {
    pendingRef.current = next
    writePendingLikes(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = readStoredLikes()
      let pending = readPendingLikes()
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
          if (body.signedIn) setSignedIn(true)
          if (body.signedIn && Array.isArray(body.likes)) {
            let saved = body.likes
            if (pending.length > 0) {
              // A session exists and this browser is holding likes the
              // record has never seen — hand them over.
              const merged = await postFan({ mergeLikes: pending })
              if (merged.ok && Array.isArray(merged.likes)) {
                saved = merged.likes
                if ((merged.skipped ?? 0) > 0) setAtCapacity(true)
              }
            }
            // Whatever the record now holds is no longer pending.
            // Anything still here genuinely did not make it, so it
            // stays queued for the next attempt and stays VISIBLE.
            pending = pending.filter(
              (track) =>
                !saved.some((entry) => entry.videoId === track.videoId),
            )
            // The server's copy wins a collision: it holds the context
            // the song was FIRST liked in.
            next = unionLikes(saved, pending)
          }
        }
      } catch {
        // The browser copy carries it.
      }
      if (cancelled) return
      likesRef.current = next
      pendingRef.current = pending
      setLikes(next)
      writeStoredLikes(next)
      writePendingLikes(pending)
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

      const dropPending = (videoId: string) =>
        commitPending(
          pendingRef.current.filter((track) => track.videoId !== videoId),
        )

      if (saved) {
        commit(current.filter((track) => track.videoId !== draft.videoId))
        // Un-liking clears any queued copy too: a song the listener just
        // removed must never be handed over by a later merge.
        dropPending(draft.videoId)
        void postFan({ unlike: draft.videoId })
        return
      }

      const track: LikedTrack = { ...draft, likedAt: new Date().toISOString() }
      commit([track, ...current])
      // Queued FIRST, cleared only once the record confirms it. A like
      // made signed out — or one whose POST never landed — is exactly
      // what the next signed-in load hands over.
      commitPending([track, ...pendingRef.current])
      void postFan({ like: track }).then((result) => {
        // A full shelf on the server refuses the save. Take the ♥ back
        // rather than showing a like that is not really there — and do
        // not queue it, because retrying would only be refused again.
        if (result.atCapacity) {
          setAtCapacity(true)
          dropPending(track.videoId)
          commit(
            likesRef.current.filter(
              (entry) => entry.videoId !== draft.videoId,
            ),
          )
          return
        }
        if (result.ok) dropPending(track.videoId)
      })
    },
    [commit, commitPending],
  )

  const dismissCapacity = useCallback(() => setAtCapacity(false), [])

  return (
    <LikesContext.Provider
      value={{
        likes,
        ready,
        signedIn,
        isLiked,
        toggleLike,
        atCapacity,
        dismissCapacity,
      }}
    >
      {children}
    </LikesContext.Provider>
  )
}

export function useLikes(): LikesContextValue {
  return useContext(LikesContext)
}
