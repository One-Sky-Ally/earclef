/**
 * Following an artist who has no Ear Clef page yet (owner, Nov 28 2026:
 * "Add every artist I've followed from Discover so they show up in my
 * Following like the rest"). Such a follow sits in the fan's ordinary
 * follows list, keyed `mb:<MusicBrainz id>`, so rows, moving and
 * unfollowing work the same for every artist; the name to show (and one
 * verified video for the card's picture) is kept beside it. When the
 * artist later gets a page, the follow becomes the page's follow, in
 * the same row — promoteRostered, run whenever the record is read.
 */
import type { ArtistTier } from '../tiers'

const PREFIX = 'mb:'
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VIDEO_ID = /^[\w-]{11}$/
const MAX_NAME = 200

/** What a page-less follow keeps: the artist's name and, optionally, a video for the card. */
export interface PagelessArtist {
  name: string
  videoId?: string
}

/** The follows-list key for an artist without a page, or null for anything but a real MusicBrainz id. */
export function artistKey(mbid: string): string | null {
  const id = mbid.trim().toLowerCase()
  return MBID.test(id) ? `${PREFIX}${id}` : null
}

/** The MusicBrainz id behind a page-less follow's key; null for a roster slug. */
export function mbidOfKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null
  const id = key.slice(PREFIX.length)
  return MBID.test(id) ? id : null
}

/** Validated, never trusted: a name of 1–200 characters and an optional 11-character video id. */
export function sanitizePageless(input: unknown): PagelessArtist | null {
  if (!input || typeof input !== 'object') return null
  const { name, videoId } = input as { name?: unknown; videoId?: unknown }
  if (typeof name !== 'string') return null
  // Shown on public pages and copied into build requests: no control or
  // direction-override characters.
  const trimmed = name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()
  if (trimmed === '' || trimmed.length > MAX_NAME) return null
  return typeof videoId === 'string' && VIDEO_ID.test(videoId)
    ? { name: trimmed, videoId }
    : { name: trimmed }
}

interface FollowParts {
  follows: readonly string[]
  tiers?: Readonly<Record<string, ArtistTier>>
  artistNames?: Readonly<Record<string, PagelessArtist>>
}

export interface Promoted {
  follows: string[]
  tiers: Record<string, ArtistTier>
  artistNames: Record<string, PagelessArtist>
  changed: boolean
}

/**
 * Page-less follows whose artist now has a page become that page's
 * follow: same place in the list, same row. Followed both ways, the
 * artist is listed once and a row chosen on the page wins. Returns new
 * objects; the input stays as it was.
 */
export function promoteRostered(parts: FollowParts, slugByMbid: Readonly<Record<string, string>>): Promoted {
  const tiers: Record<string, ArtistTier> = { ...parts.tiers }
  const artistNames: Record<string, PagelessArtist> = { ...parts.artistNames }
  const seen = new Set<string>()
  const follows: string[] = []
  let changed = false
  for (const key of parts.follows) {
    const mbid = mbidOfKey(key)
    const slug = mbid ? slugByMbid[mbid] : undefined
    const kept = slug ?? key
    if (slug) {
      changed = true
      if (tiers[key] && !tiers[slug]) tiers[slug] = tiers[key]
      delete tiers[key]
      delete artistNames[key]
    }
    if (seen.has(kept)) continue
    seen.add(kept)
    follows.push(kept)
  }
  return { follows, tiers, artistNames, changed }
}

/** A page-less follow as the browser gets it: who, and the card's video. */
export interface PagelessView extends PagelessArtist {
  mbid: string
}

/** The page-less follows among `follows`, by key — only those with a name to show. */
export function pagelessView(
  follows: readonly string[],
  artistNames: Readonly<Record<string, PagelessArtist>> | undefined,
): Record<string, PagelessView> {
  return Object.fromEntries(
    follows.flatMap((key) => {
      const mbid = mbidOfKey(key)
      const artist = artistNames?.[key]
      return mbid && artist ? [[key, { mbid, ...artist }] as const] : []
    }),
  )
}
