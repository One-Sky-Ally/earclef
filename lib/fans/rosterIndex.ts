/**
 * MusicBrainz id → roster slug, for turning a page-less follow into the
 * page's follow once the artist has one (./artistKeys). Server only:
 * read from the committed content once per process.
 */
import { getAllArtists } from '../content'

let cached: Readonly<Record<string, string>> | null = null

export function rosterSlugByMbid(): Readonly<Record<string, string>> {
  cached ??= Object.fromEntries(
    getAllArtists().flatMap((artist) => {
      const mbid = artist.integrations.setlistfm.mbid?.trim().toLowerCase()
      return mbid ? [[mbid, artist.slug] as const] : []
    }),
  )
  return cached
}
