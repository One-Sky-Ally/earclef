'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  onPlayedChange,
  parsePlayed,
  readPlayedRaw,
  syncPlayed,
  type PlayedMarks,
} from '@/lib/discover/played'

/**
 * The Discover artists this listener has played (lib/discover/played.ts),
 * kept in step across the row, the past-picks page and other tabs. When
 * signed in, the account's list replaces this browser's copy once per
 * page. `ready` is false on the server render, before storage is read.
 */
export function usePlayedMarks(): { marks: PlayedMarks; ready: boolean } {
  const raw = useSyncExternalStore(onPlayedChange, readPlayedRaw, () => undefined)
  const marks = useMemo(() => parsePlayed(raw ?? null), [raw])
  useEffect(() => {
    void syncPlayed()
  }, [])
  return { marks, ready: raw !== undefined }
}
