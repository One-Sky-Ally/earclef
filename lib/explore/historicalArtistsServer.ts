/**
 * SERVER-ONLY roster of MB artists filed under historical country
 * areas (Soviet Union, Yugoslavia, Czechoslovakia, East Germany) whose
 * begin-area walks to a modern country — the population the panels'
 * `country:{ISO2}` queries can structurally never match (audit,
 * Aug 27 2026: 1,144 artists across 37 countries).
 *
 * Merged into panel responses at RESPOND time, never into memo/Blobs
 * (the extraArtists pattern): cached payloads stay as stored and
 * roster updates ride each deploy's CDN purge. These are real MB
 * artists — same pill, same play resolver, same genre tags — so they
 * join the pool, its count, the genre filter and the queue as full
 * members, appended after the live-ranked pool in their own tag-vote
 * order (no cross-request ranking invented).
 */
import roster from './historical-area-artists.json'
import type { CountryYearDetails, PoolArtist } from './panelData'

interface HistoricalArtist {
  mbid: string
  name: string
  type: string | null
  lifeBegin: number | null
  lifeEnd: number | null
  ended: boolean
  tags: string[]
  votes: number
  polity: string
}

const DATASET = roster as unknown as {
  generatedAt: string
  countries: Record<string, HistoricalArtist[]>
}

/**
 * Era rule mirrors the live origin query exactly (`begin:[* TO end]
 * AND NOT end:[* TO start-1]`): began by the span's end, didn't end
 * before its start — and an absent begin never matches (lesson 5),
 * same as Lucene's range operator.
 */
const PERSON_CAREER_OFFSET_YEARS = 15

function eraEligible(
  artist: HistoricalArtist,
  yearStart: number,
  yearEnd: number,
): boolean {
  if (artist.lifeBegin === null) return false
  // Same person-career convention as the live path's activeByRangeEnd:
  // for a Person, MB "begin" is the birth date — a newborn isn't active.
  const careerStart =
    artist.type === 'Person'
      ? artist.lifeBegin + PERSON_CAREER_OFFSET_YEARS
      : artist.lifeBegin
  if (careerStart > yearEnd) return false
  return !(artist.lifeEnd !== null && artist.lifeEnd < yearStart)
}

/**
 * Merge era-eligible roster artists for a place into a panel response.
 * No-ops for subdivision codes (roster is country-keyed), stored
 * pre-pool payloads (no panelArtists to join — the standard
 * degradation), and lens requests whose genre the artist's tags don't
 * carry.
 */
export function withHistoricalArtists(
  details: CountryYearDetails,
  code: string,
  yearStart: number,
  yearEnd: number,
  genre: string | null,
): CountryYearDetails {
  const rows = DATASET.countries[code] ?? []
  if (rows.length === 0 || !details.panelArtists) return details
  const seen = new Set(details.panelArtists.map((artist) => artist.id))
  const merged: PoolArtist[] = rows
    .filter(
      (artist) =>
        eraEligible(artist, yearStart, yearEnd) &&
        !seen.has(artist.mbid) &&
        (!genre || artist.tags.includes(genre)),
    )
    .map((artist) => ({ id: artist.mbid, name: artist.name, tags: artist.tags }))
  if (merged.length === 0) return details
  return {
    ...details,
    totalCount: details.totalCount + merged.length,
    panelArtists: [...details.panelArtists, ...merged],
  }
}
