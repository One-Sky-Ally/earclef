/**
 * Client-side access to the verified-play resolver, tuned for panels
 * that resolve a visible tier of artists at once: a session-lived
 * cache (the API layer caches 30 days) plus a small concurrency gate
 * so a fresh panel doesn't burst-fire upstream lookups.
 */
import type { ArtistPlay } from './types'

const cache = new Map<string, ArtistPlay>()
const MAX_CONCURRENT = 3

let active = 0
const waiters: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve)
  })
  active += 1
}

function releaseSlot(): void {
  active -= 1
  waiters.shift()?.()
}

export interface PlayRequest {
  /** Resolver key: mb:<mbid> | dg:<id> | wd:<Q-id> | nm:<slug>. */
  key: string
  /** Required for non-MB keys (Internet Archive creator search). */
  name?: string
  /** Era hint — lets mb: keys reuse queue-verified videos. */
  decade?: number
}

/**
 * Resolve one artist's verified play destination. Returns null on any
 * failure — callers render no play button, which is the honest default.
 */
export async function fetchArtistPlay(
  { key, name, decade }: PlayRequest,
  signal: AbortSignal,
): Promise<ArtistPlay | null> {
  const cacheKey = `${key}|${decade ?? ''}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  await acquireSlot()
  try {
    if (signal.aborted) return null
    const params = new URLSearchParams()
    if (name) params.set('name', name)
    if (decade) params.set('decade', String(decade))
    const query = params.size > 0 ? `?${params}` : ''
    const res = await fetch(
      `/api/play/${encodeURIComponent(key)}${query}`,
      { signal },
    )
    if (!res.ok) return null
    const result = (await res.json()) as ArtistPlay
    cache.set(cacheKey, result)
    return result
  } catch {
    return null
  } finally {
    releaseSlot()
  }
}
