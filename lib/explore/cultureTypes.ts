/**
 * Music cultures — types and pure helpers, safe for the browser. The
 * data itself (lib/explore/cultures.json, written by
 * scripts/build-cultures.mjs) stays on the server: pages pass journey
 * SUMMARIES down, and a journey's songs load from
 * /api/explore/journey/[id] when it opens.
 */

export interface CultureSource {
  label: string
  url: string
}

/** A song in a journey — every one plays here (owner rule, Oct 14 2026). */
export interface CultureTrack {
  artist: string
  title: string
  /** A video the site already verified for this exact song. */
  videoId: string
  /** `pick` = a documented era pick; `more` = released in the place/span. */
  group: 'pick' | 'more'
  /** Chart note or context from the snapshot, e.g. "Hot 100 #1, 1967". */
  note?: string
  /** Release year, for songs drawn from the catalogue. */
  year?: number
  /** Which verified source a pick's video came from. */
  source?: 'chart' | 'songs-about' | 'on-this-day'
  /** The verified video is a live version, not the record. */
  live?: boolean
  mbid?: string
}

interface JourneyBase {
  id: string
  code: string
  place: string
  from: number
  to: number
  title: string
  /** Playable songs in the journey. */
  count: number
  thumb: string
  tracks: CultureTrack[]
}

/** A "What was playing" era: documented place + era + sound. */
export interface EraJourney extends JourneyBase {
  kind: 'era'
  /** charted = a national chart archive; documented = scene history. */
  basisKind: 'charted' | 'documented'
  basis: string
  summary: string
  sources: CultureSource[]
  /** How many of the tracks are the era's own documented picks. */
  picks: number
}

/** A place and a decade, from the verified On-this-day catalogue. */
export interface DecadeJourney extends JourneyBase {
  kind: 'decade'
  genres: string[]
  artistCount: number
}

export type Journey = EraJourney | DecadeJourney

interface SummaryBase {
  id: string
  code: string
  place: string
  from: number
  to: number
  title: string
  count: number
  thumb: string
}

/** What a page needs to show a journey card or feature it. */
export interface EraSummary extends SummaryBase {
  kind: 'era'
}

export interface DecadeSummary extends SummaryBase {
  kind: 'decade'
  genres: string[]
  artistCount: number
}

export type JourneySummary = EraSummary | DecadeSummary

/** A "Songs about this place" list — its songs load on demand. */
export interface SongPlace {
  id: string
  kind: 'songs'
  code: string
  place: string
  placeKind: 'country' | 'us-state' | 'uk-nation' | 'city'
  count: number
  firstYear: number | null
  lastYear: number | null
  thumb: string
}

export type Culture = JourneySummary | SongPlace

export function eraSpan(culture: { from: number; to: number }): string {
  return culture.from === culture.to
    ? `${culture.from}`
    : `${culture.from}–${culture.to}`
}

/** "1980s" for a decade journey, "1965–1969" for an era. */
export function journeySpan(culture: { kind: string; from: number; to: number }): string {
  return culture.kind === 'decade' ? `${culture.from}s` : eraSpan(culture)
}

/** The year the globe moves to for a journey: its middle. */
export function eraYear(culture: { from: number; to: number }): number {
  return Math.floor((culture.from + culture.to) / 2)
}

/** "j-pop, rock and city pop". */
export function genreList(genres: string[] = []): string {
  if (genres.length <= 1) return genres[0] ?? ''
  return `${genres.slice(0, -1).join(', ')} and ${genres[genres.length - 1]}`
}

/** Stable pseudo-random order, so the daily journey rotates by place. */
function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Journeys in a fixed shuffled order — the daily pick walks this. */
export function rotationOrder(journeys: JourneySummary[]): JourneySummary[] {
  return [...journeys].sort((a, b) => hash(a.id) - hash(b.id))
}

/**
 * The culture row: documented eras (oldest first) interleaved with one
 * decade journey per country (its fullest decade) and the largest
 * "Songs about" countries, so places, eras and kinds stay mixed.
 */
export function cultureRow(
  journeys: JourneySummary[],
  songs: SongPlace[],
  songSlots = 6,
): Culture[] {
  const eras = journeys
    .filter((journey) => journey.kind === 'era')
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const bestByCountry = new Map<string, JourneySummary>()
  for (const journey of journeys) {
    if (journey.kind !== 'decade') continue
    const best = bestByCountry.get(journey.code)
    if (!best || best.kind !== 'decade' || journey.artistCount > best.artistCount) {
      bestByCountry.set(journey.code, journey)
    }
  }
  const decades = rotationOrder([...bestByCountry.values()])
  const songPicks = songs
    .filter((place) => place.placeKind === 'country' && place.count >= 5)
    .slice(0, songSlots)
  const row: Culture[] = []
  let decadeAt = 0
  let songAt = 0
  eras.forEach((era, index) => {
    row.push(era)
    if (decadeAt < decades.length) row.push(decades[decadeAt++])
    if (index % 3 === 2 && songAt < songPicks.length) row.push(songPicks[songAt++])
  })
  return [...row, ...decades.slice(decadeAt), ...songPicks.slice(songAt)]
}
