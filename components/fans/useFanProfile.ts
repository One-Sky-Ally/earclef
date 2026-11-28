'use client'

import { useSyncExternalStore } from 'react'
import type { PagelessView } from '@/lib/fans/artistKeys'
import type { ArtistTier } from '@/lib/tiers'

/** The signed-in fan as /api/fan answers (or a signed-out visitor). */
export interface FanProfile {
  signedIn: boolean
  email?: string
  /** Roster slugs and `mb:<id>` keys for artists with no page yet. */
  follows: string[]
  tiers?: Record<string, ArtistTier>
  stamps?: Record<string, { number: number; since: string }>
  /** Who the page-less follows are, by key. */
  artists?: Record<string, PagelessView>
}

export type FanProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: FanProfile }

/**
 * One read of /api/fan per page, shared by every Follow button and the
 * Artists page rows: All past picks shows hundreds of Follow buttons,
 * and a follow made on a Discover card has to show in the rows at once.
 * Re-read whenever the first subscriber mounts, so a page reached by
 * client navigation never shows follows changed elsewhere as stale.
 */
let state: FanProfileState = { status: 'loading' }
let inFlight = false
/**
 * Bumped by every change made on this page: a read that started before
 * it would put back what the change replaced, so its answer is dropped.
 */
let changes = 0
const listeners = new Set<() => void>()

function publish(next: FanProfileState) {
  state = next
  listeners.forEach((listener) => listener())
}

async function load() {
  if (inFlight) return
  inFlight = true
  const startedAt = changes
  try {
    const res = await fetch('/api/fan')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as FanProfile
    if (changes !== startedAt) return
    publish({ status: 'ready', profile: { ...body, follows: Array.isArray(body.follows) ? body.follows : [] } })
  } catch {
    if (changes === startedAt && state.status !== 'ready') publish({ status: 'error' })
  } finally {
    inFlight = false
  }
}

function subscribe(listener: () => void) {
  const first = listeners.size === 0
  listeners.add(listener)
  if (first) void load()
  return () => {
    listeners.delete(listener)
  }
}

const LOADING: FanProfileState = { status: 'loading' }

export function useFanProfile(): FanProfileState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => LOADING,
  )
}

/** Folds a /api/fan POST answer into the shared profile. */
export function mergeFanProfile(next: Partial<FanProfile>) {
  if (state.status !== 'ready') return
  changes++
  const current = state.profile
  publish({
    status: 'ready',
    profile: {
      ...current,
      follows: next.follows ?? current.follows,
      tiers: next.tiers ?? current.tiers,
      stamps: next.stamps ?? current.stamps,
      artists: next.artists ?? current.artists,
    },
  })
}
