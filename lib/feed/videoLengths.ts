/**
 * How long each feed video runs, from YouTube's videos.list
 * (contentDetails: 1 quota unit per 50 ids), remembered in the Blobs
 * "feed" store so a video is looked up once, not on every rebuild or
 * read. Used by the nightly rebuild (stamps `seconds` on each video) and
 * by /api/feed/snapshot (judges snapshots stored before the length rule
 * existed — stored output outlives the generator that wrote it).
 *
 * RELATIVE imports only — bundled into the Netlify background function.
 */
import { getStore } from '@netlify/blobs'
import {
  freshLengths,
  parseIsoDurationSeconds,
  type LengthCache,
} from './clipLength'

const LENGTHS_KEY = 'video-lengths/v1'
const IDS_PER_CALL = 50
/** The nightly rebuild can wait; a visitor's read cannot (see the route). */
export const REBUILD_TIMEOUT_MS = 6000
export const READ_TIMEOUT_MS = 2500

let devLengths: LengthCache = {}

function store() {
  return getStore({ name: 'feed', consistency: 'strong' })
}

async function readLengths(): Promise<LengthCache> {
  try {
    return ((await store().get(LENGTHS_KEY, { type: 'json' })) ??
      {}) as LengthCache
  } catch {
    return devLengths
  }
}

async function writeLengths(cache: LengthCache): Promise<void> {
  try {
    await store().setJSON(LENGTHS_KEY, cache)
  } catch {
    devLengths = cache
  }
}

async function fetchChunk(
  ids: string[],
  key: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Record<string, number>> {
  try {
    const res = await fetchImpl(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${key}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    )
    if (!res.ok) return {}
    const body = (await res.json()) as {
      items?: { id: string; contentDetails?: { duration?: string } }[]
    }
    return Object.fromEntries(
      (body.items ?? []).flatMap((item) => {
        const seconds = parseIsoDurationSeconds(item.contentDetails?.duration)
        return seconds === null ? [] : [[item.id, seconds]]
      }),
    )
  } catch {
    // Quota, timeout or network: unknown, decided on a later pass.
    return {}
  }
}

/**
 * Seconds per id for the ids YouTube answered. Deleted or private videos
 * are simply absent (the oEmbed check prunes those); a failed call
 * leaves its ids unknown.
 */
export async function fetchLengths(
  ids: string[],
  key: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REBUILD_TIMEOUT_MS,
): Promise<Record<string, number>> {
  const chunks: string[][] = []
  for (let start = 0; start < ids.length; start += IDS_PER_CALL) {
    chunks.push(ids.slice(start, start + IDS_PER_CALL))
  }
  const answers = await Promise.all(
    chunks.map((chunk) => fetchChunk(chunk, key, fetchImpl, timeoutMs)),
  )
  return Object.assign({}, ...answers)
}

/**
 * Lengths for `ids`: remembered ones from the cache, the rest asked of
 * YouTube (when a key is set) and remembered. Ids still unknown are left
 * out — the caller keeps those videos. Expired entries are deleted from
 * the store, not just ignored (the 30-day rule is refresh OR delete).
 */
export async function learnLengths(
  ids: string[],
  timeoutMs: number = REBUILD_TIMEOUT_MS,
  key: string | undefined = process.env.YOUTUBE_API_KEY,
): Promise<Record<string, number>> {
  const now = Date.now()
  const stored = await readLengths()
  const known = freshLengths(stored, now)
  const expired = Object.keys(known).length < Object.keys(stored).length
  const missing = [...new Set(ids)].filter((id) => !(id in known))
  const fetched =
    missing.length > 0 && key ? await fetchLengths(missing, key, fetch, timeoutMs) : {}

  const at = new Date(now).toISOString()
  const merged: LengthCache = {
    ...known,
    ...Object.fromEntries(
      Object.entries(fetched).map(([id, s]) => [id, { s, at }]),
    ),
  }
  if (expired || Object.keys(fetched).length > 0) await writeLengths(merged)

  return Object.fromEntries(
    ids.filter((id) => id in merged).map((id) => [id, merged[id].s]),
  )
}
