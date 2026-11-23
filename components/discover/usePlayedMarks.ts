'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { onPlayedChange, parsePlayed, readPlayedRaw, type PlayedMarks } from '@/lib/discover/played'

/**
 * The Discover artists played in this browser (lib/discover/played.ts),
 * kept in step across the row, the past-picks page and other tabs.
 * `ready` is false on the server render, before storage can be read.
 */
export function usePlayedMarks(): { marks: PlayedMarks; ready: boolean } {
  const raw = useSyncExternalStore(onPlayedChange, readPlayedRaw, () => undefined)
  const marks = useMemo(() => parsePlayed(raw ?? null), [raw])
  return { marks, ready: raw !== undefined }
}
