/**
 * SERVER-ONLY claimed-place rosters. Panels for claimed places are
 * served entirely from committed, evidence-vetted roster files —
 * there is no MB country query for a place the state system doesn't
 * hold, which is the whole point.
 *
 * Era rules match the site: began by the span's end (+15 for persons —
 * MB "begin" is a birth date), didn't end before its start; undated
 * artists are excluded from spans ending before 1980 (the state-layer
 * era-honesty rule) and sort last otherwise.
 */
import tibet from './claimed-places/tibet.json'
import { claimedPlaceById } from './claimedPlaces'
import type { CountryYearDetails, PoolArtist } from './panelData'

interface ClaimedArtist {
  mbid: string
  name: string
  type: string | null
  lifeBegin: number | null
  lifeEnd: number | null
  tags: string[]
  filing: string
  evidence: string
}

const ROSTERS: Record<string, ClaimedArtist[]> = {
  tibet: (tibet as { artists: ClaimedArtist[] }).artists,
}

const PERSON_CAREER_OFFSET_YEARS = 15
const UNDATED_ERA_FLOOR = 1980

function eraEligible(
  artist: ClaimedArtist,
  yearStart: number,
  yearEnd: number,
): boolean {
  if (artist.lifeBegin === null) return yearEnd >= UNDATED_ERA_FLOOR
  const careerStart =
    artist.type === 'Person'
      ? artist.lifeBegin + PERSON_CAREER_OFFSET_YEARS
      : artist.lifeBegin
  if (careerStart > yearEnd) return false
  return !(artist.lifeEnd !== null && artist.lifeEnd < yearStart)
}

/** Panel details for a claimed place, or null if the code isn't one. */
export function claimedPlaceDetails(
  code: string,
  yearStart: number,
  yearEnd: number,
): CountryYearDetails | null {
  const place = claimedPlaceById(code)
  const roster = ROSTERS[code]
  if (!place || !roster) return null
  const eligible = roster.filter((artist) =>
    eraEligible(artist, yearStart, yearEnd),
  )
  const dated = eligible.filter((artist) => artist.lifeBegin !== null)
  const undated = eligible.filter((artist) => artist.lifeBegin === null)
  const shape = (artist: ClaimedArtist): PoolArtist => ({
    id: artist.mbid,
    name: artist.name,
    tags: artist.tags,
  })
  const pool = [...dated, ...undated].map(shape)
  return {
    totalCount: pool.length,
    originArtists: pool.slice(0, 12).map(({ id, name }) => ({ id, name })),
    panelArtists: pool,
    artists: [],
    releases: [],
  }
}
