/**
 * Music cultures — SERVER-ONLY (imports the generated data). Pages pass
 * JOURNEY_SUMMARIES and SONG_PLACES to the browser; a journey's songs
 * load from /api/explore/journey/[id] via journeyById. Everything here
 * is an EAR CLEF PICK drawn from content the site already plays, built
 * by scripts/build-cultures.mjs (rules in scripts/lib/cultures.mjs).
 */
import data from './cultures.json'
import type {
  DecadeJourney,
  EraJourney,
  Journey,
  JourneySummary,
  SongPlace,
} from './cultureTypes'

interface CulturesFile {
  eras: EraJourney[]
  decades: DecadeJourney[]
  songs: SongPlace[]
}

const file = data as unknown as CulturesFile

const JOURNEYS: Journey[] = [...file.eras, ...file.decades]
const BY_ID = new Map(JOURNEYS.map((journey) => [journey.id, journey]))

function summarize(journey: Journey): JourneySummary {
  const base = {
    id: journey.id,
    code: journey.code,
    place: journey.place,
    from: journey.from,
    to: journey.to,
    title: journey.title,
    count: journey.count,
    thumb: journey.thumb,
  }
  return journey.kind === 'decade'
    ? { ...base, kind: 'decade', genres: journey.genres, artistCount: journey.artistCount }
    : { ...base, kind: 'era' }
}

export const JOURNEY_SUMMARIES: JourneySummary[] = JOURNEYS.map(summarize)
export const SONG_PLACES: SongPlace[] = file.songs

export function journeyById(id: string): Journey | null {
  return BY_ID.get(id) ?? null
}
