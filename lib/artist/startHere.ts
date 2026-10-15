/**
 * An artist's verified songs beyond their hand-picked videos, written at
 * build time by scripts/build-start-here.mjs (rules in
 * scripts/lib/startHere.mjs). SERVER-ONLY: the artist page passes just
 * that artist's list to the browser.
 */
import data from './start-here.json'

export interface StartHereSong {
  /** Verified YouTube id. */
  v: string
  /** Song title. */
  t: string
  /** Release year, when known. */
  y?: number
  /** The release it comes from, when that differs from the song. */
  r?: string
  s: 'on-this-day' | 'songs-about'
}

const file = data as unknown as Record<string, StartHereSong[]>

export function startHereSongs(slug: string): StartHereSong[] {
  return file[slug] ?? []
}
