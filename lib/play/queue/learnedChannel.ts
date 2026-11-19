/**
 * Channels a verified find taught us (owner go, Nov 19 2026: "re-using a
 * found channel for an artist's other decades").
 *
 * When a Discogs lead or a search result passes the artistMatch checks
 * (an uploader named for the artist, and a title naming one of their own
 * works), that uploader is the artist's channel. It is stored here so the
 * artist's OTHER decades read its uploads (1 unit per 50, the 10,000
 * bucket) instead of each spending a search. A searched artist sits in
 * about four decades, so this saves up to three searches in four.
 * Every upload taken from it still has to name one of the artist's works.
 *
 * YouTube's Developer Policies (III.E.4) allow stored API data 30 days
 * without a refresh. A stored channel is re-read with channels.list after
 * REFRESH_AFTER_DAYS. If its title no longer names the artist, it is
 * dropped. Relative imports only: bundled into Netlify functions.
 */
import { getStore } from '@netlify/blobs'
import { channelMatchesArtist } from '../artistMatch'
import { channelTitles, QuotaError } from '../channelSongs'

export interface LearnedChannel {
  channelId: string
  channelTitle: string
  /** How it was learned: a Discogs lead or a search result. */
  via: 'discogs' | 'search'
  at: string
  checkedAt: string
}

/** Re-read stored YouTube facts before they reach 30 days. */
export const REFRESH_AFTER_DAYS = 21
const REFRESH_AFTER_MS = REFRESH_AFTER_DAYS * 86_400_000

export function learnedStore() {
  return getStore({ name: 'artist-channel', consistency: 'eventual' })
}

export async function saveLearnedChannel(
  mbid: string,
  channel: Pick<LearnedChannel, 'channelId' | 'channelTitle' | 'via'>,
): Promise<void> {
  const now = new Date().toISOString()
  try {
    await learnedStore().setJSON(mbid, { ...channel, at: now, checkedAt: now } satisfies LearnedChannel)
  } catch {
    // Best-effort: the next verified find teaches it again.
  }
}

/**
 * The artist's learned channel, refreshed when stale. A refresh that
 * finds the channel gone or renamed away from the artist deletes it.
 * A quota refusal serves the stored channel this once; the next read
 * tries the refresh again.
 */
export async function learnedChannelFor(
  mbid: string,
  names: Set<string>,
  apiKey: string,
): Promise<LearnedChannel | null> {
  let held: LearnedChannel | null = null
  try {
    held = (await learnedStore().get(mbid, { type: 'json' })) as LearnedChannel | null
  } catch {
    return null
  }
  if (!held?.channelId) return null
  if (Date.now() - Date.parse(held.checkedAt ?? held.at) < REFRESH_AFTER_MS) return held
  try {
    const title = (await channelTitles([held.channelId], apiKey)).get(held.channelId)
    if (!title || !channelMatchesArtist(title, names)) {
      await learnedStore().delete(mbid).catch(() => undefined)
      return null
    }
    const fresh = { ...held, channelTitle: title, checkedAt: new Date().toISOString() }
    await learnedStore().setJSON(mbid, fresh).catch(() => undefined)
    return fresh
  } catch (error) {
    if (error instanceof QuotaError) return held
    return held
  }
}
