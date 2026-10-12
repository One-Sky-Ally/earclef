/**
 * "Songs about this place" (owner go, Oct 12 2026): songs written about
 * a country, a US state or a UK nation, read from the committed sweep
 * output lib/explore/songs-about-places.json. Only songs with a
 * playability-checked video are in the file — the owner's ruling is
 * never to list music people cannot listen to on the site. Songs about
 * a city or a state also appear under their country, labelled with the
 * specific place (`about`).
 */
import data from './songs-about-places.json'

export type SongKind = 'official-video' | 'audio' | 'video'

export interface PlaceSong {
  /** Song title, as Wikidata/Wikipedia name it. */
  t: string
  /** Performer name. */
  a: string
  /** Performer's MusicBrainz id. */
  mbid: string
  /** Verified, playability-checked YouTube video id. */
  v: string
  k: SongKind
  /** Wikipedia article title (the source of the "about" claim). */
  wp: string
  /** First publication year, when Wikidata has one. */
  y?: number
  /** The specific place when the song rolls up to a country ("Paris"). */
  about?: string
  /** The video is a version of the song, not the plain record. */
  ver?: string
}

export interface PlaceSongs {
  name: string
  kind: 'country' | 'us-state' | 'uk-nation' | 'city'
  songs: PlaceSong[]
}

interface SongsAboutFile {
  generatedAt: string
  source: string
  places: Record<string, PlaceSongs>
}

const file = data as SongsAboutFile

export const PLACE_KEY = /^[A-Z]{2}(?:-[A-Z]{2,3})?$/

/** Songs about one place, or null when the sweep found none it can play. */
export function songsAboutPlace(key: string): PlaceSongs | null {
  if (!PLACE_KEY.test(key)) return null
  const place = file.places[key]
  return place && place.songs.length > 0 ? place : null
}
