export interface CountryFeature {
  properties: { ADMIN: string; ISO_A2: string }
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

/** Rough centroid of a country's largest ring — good enough to aim a camera. */
export function roughCentroid(feature: CountryFeature): {
  lat: number
  lng: number
} {
  const { type, coordinates } = feature.geometry
  const rings =
    type === 'Polygon'
      ? [(coordinates as number[][][])[0]]
      : (coordinates as number[][][][]).map((polygon) => polygon[0])
  const largest = rings.reduce((a, b) => (b.length > a.length ? b : a))
  let lat = 0
  let lng = 0
  for (const [x, y] of largest) {
    lng += x
    lat += y
  }
  return { lat: lat / largest.length, lng: lng / largest.length }
}

// Natural Earth marks some territories -99; map the ones MusicBrainz knows.
const ISO_FIXES: Record<string, string> = { France: 'FR', Norway: 'NO' }

export function isoOf(feature: CountryFeature): string | undefined {
  const { ISO_A2, ADMIN } = feature.properties
  if (/^[A-Z]{2}$/.test(ISO_A2)) return ISO_A2
  return ISO_FIXES[ADMIN]
}
