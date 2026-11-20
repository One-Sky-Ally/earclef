'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { oneSound } from '@/lib/play/oneSound'

/**
 * A player's seat in the page's one sound (lib/play/oneSound.ts).
 *
 * Call `claim()` whenever this player starts sounding — its ▶, a track
 * change, or YouTube's own play button on a paused player. `onStopped`
 * runs when ANOTHER player claims the sound: pause, or close the
 * player. `holds()` says whether this player may sound right now, so a
 * player that finishes loading after another one started stays quiet.
 * Unmounting gives the seat up.
 */
export function useOneSound(onStopped: () => void) {
  const [id] = useState(() => Symbol('player'))
  const stopRef = useRef(onStopped)
  useEffect(() => {
    stopRef.current = onStopped
  })
  useEffect(() => () => oneSound.release(id), [id])

  const claim = useCallback(() => oneSound.claim(id, () => stopRef.current()), [id])
  const holds = useCallback(() => oneSound.holds(id), [id])
  return { claim, holds }
}
