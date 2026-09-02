/**
 * "On the radar", derived — never stored.
 *
 * Liking a song puts its artist on the third tier of the taste map.
 * That tier is COMPUTED from the likes every time rather than written
 * anywhere, so it cannot drift: un-like the last song by someone and
 * they leave the radar on their own, with no second record to keep in
 * step. The only state this needs is the list of artists the listener
 * has explicitly dismissed.
 *
 * Identity is the MusicBrainz id and nothing else. Pre-resolved
 * #1-hits likes carry no MBID, and a bare artist name is not an
 * identity — so those likes save the song and can never put anyone
 * here. They are COUNTED and disclosed rather than quietly ignored.
 */
import type { LikedTrack } from './likes'

export interface RadarArtist {
  mbid: string
  /** As the queue named them on the most recent like. */
  name: string
  /** The roster page this artist already has, when there is one. */
  slug?: string
  /** How many of the listener's saved songs are theirs. */
  songs: number
  lastLikedAt: string
}

export interface RadarResult {
  artists: RadarArtist[]
  /**
   * Saved songs whose artist cannot be identified (no MBID). Not a
   * failure — a fact worth stating where a listener might otherwise
   * wonder why a song they saved put nobody on the radar.
   */
  withoutIdentity: number
  /**
   * Artists the listener took off the radar who are STILL behind saved
   * songs — the ones a "show them again" can bring back. Stale ids from
   * songs since un-liked are not counted: offering to restore someone
   * who would not reappear would be a lie.
   */
  dismissedMbids: string[]
}

interface DeriveRadarInput {
  likes: LikedTrack[]
  /** MBIDs the listener has taken off the radar. */
  dismissed: string[]
  rosterByMbid: Record<string, { slug: string; name: string }>
  /** Slugs already followed — they are placed on the map elsewhere. */
  followedSlugs: string[]
}

export function deriveRadar({
  likes,
  dismissed,
  rosterByMbid,
  followedSlugs,
}: DeriveRadarInput): RadarResult {
  const dropped = new Set(dismissed)
  const followed = new Set(followedSlugs)
  const byMbid = new Map<string, RadarArtist>()
  const dismissedPresent = new Set<string>()
  let withoutIdentity = 0

  for (const track of likes) {
    if (!track.mbid) {
      withoutIdentity += 1
      continue
    }
    if (dropped.has(track.mbid)) {
      dismissedPresent.add(track.mbid)
      continue
    }

    const rostered = rosterByMbid[track.mbid]
    // An artist the listener already follows is on the map under
    // whatever tier they chose; the radar must not shadow that.
    if (rostered && followed.has(rostered.slug)) continue

    const existing = byMbid.get(track.mbid)
    if (!existing) {
      byMbid.set(track.mbid, {
        mbid: track.mbid,
        name: track.artistName,
        ...(rostered && { slug: rostered.slug }),
        songs: 1,
        lastLikedAt: track.likedAt,
      })
      continue
    }
    byMbid.set(track.mbid, {
      ...existing,
      songs: existing.songs + 1,
      // The likes arrive newest first, so the first name seen is the
      // most recent one — keep it, and keep the newest timestamp.
      lastLikedAt:
        existing.lastLikedAt >= track.likedAt
          ? existing.lastLikedAt
          : track.likedAt,
    })
  }

  const artists = [...byMbid.values()].sort(
    (a, b) =>
      b.songs - a.songs ||
      b.lastLikedAt.localeCompare(a.lastLikedAt) ||
      a.name.localeCompare(b.name),
  )
  return { artists, withoutIdentity, dismissedMbids: [...dismissedPresent] }
}
