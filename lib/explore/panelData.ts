export interface PanelArtist {
  id: string
  name: string
}

export interface PanelRelease {
  id: string
  title: string
  date?: string
  artist: PanelArtist
}

export interface CountryYearDetails {
  totalCount: number
  artists: PanelArtist[]
  releases: PanelRelease[]
}

export function musicBrainzArtistUrl(id: string): string {
  return `https://musicbrainz.org/artist/${id}`
}

export function musicBrainzReleaseUrl(id: string): string {
  return `https://musicbrainz.org/release/${id}`
}

export async function fetchCountryYearDetails(
  country: string,
  year: number,
  signal: AbortSignal,
): Promise<CountryYearDetails> {
  const res = await fetch(`/api/explore/${country}/${year}`, { signal })
  if (res.status === 429) {
    throw new Error('MusicBrainz is busy right now — try again in a moment.')
  }
  if (!res.ok) {
    throw new Error('Could not load releases for this country.')
  }
  return res.json()
}
