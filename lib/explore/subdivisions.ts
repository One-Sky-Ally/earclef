import type { CountryFeature } from './geo'

/**
 * Sub-national regions that deserve their own spot on the globe —
 * places far from their country's mainland with a musical identity of
 * their own. Each gets its polygons split out of the parent country's
 * feature and its own panel driven by MusicBrainz AREA queries
 * (artists only: release pressing data is country-level in MB).
 * Hawaii ships first; add a config entry to light up another region.
 */

export interface Subdivision {
  /** Panel/route code, ISO-3166-2 style. */
  code: string
  name: string
  countryCode: string
  /** MusicBrainz area name for artist `area:` queries. */
  mbArea: string
  /** Ring-classifier bounds: [minLng, maxLng, minLat, maxLat]. */
  bbox: [number, number, number, number]
}

export const SUBDIVISIONS: Subdivision[] = [
  {
    code: 'US-HI',
    name: 'Hawaii',
    countryCode: 'US',
    mbArea: 'Hawaii',
    bbox: [-161.5, -154, 18, 23],
  },
]

const byCode = new Map(SUBDIVISIONS.map((sub) => [sub.code, sub]))

export const SUBDIVISION_CODE_PATTERN = /^[A-Z]{2}-[A-Z]{2}$/

export function subdivisionByCode(code: string): Subdivision | undefined {
  return byCode.get(code)
}

export function subdivisionByName(name: string): Subdivision | undefined {
  const query = name.trim().toLowerCase()
  return SUBDIVISIONS.find((sub) => sub.name.toLowerCase() === query)
}

function ringInBbox(
  ring: number[][],
  [minLng, maxLng, minLat, maxLat]: Subdivision['bbox'],
): boolean {
  return ring.every(
    ([lng, lat]) =>
      lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat,
  )
}

/**
 * Splits configured subdivisions out of their parent country features:
 * the parent keeps its remaining polygons, the subdivision becomes its
 * own feature carrying the subdivision code in ISO_A2. Non-destructive
 * — returns a new feature list.
 */
export function splitSubdivisionFeatures(
  features: CountryFeature[],
): CountryFeature[] {
  const result: CountryFeature[] = []

  for (const feature of features) {
    const subs = SUBDIVISIONS.filter(
      (sub) =>
        feature.properties.ISO_A2 === sub.countryCode &&
        feature.geometry.type === 'MultiPolygon',
    )
    if (subs.length === 0) {
      result.push(feature)
      continue
    }

    let remaining = feature.geometry.coordinates as number[][][][]
    for (const sub of subs) {
      const matched = remaining.filter((polygon) =>
        ringInBbox(polygon[0], sub.bbox),
      )
      if (matched.length === 0) continue
      remaining = remaining.filter(
        (polygon) => !ringInBbox(polygon[0], sub.bbox),
      )
      result.push({
        properties: { ADMIN: sub.name, ISO_A2: sub.code },
        geometry: { type: 'MultiPolygon', coordinates: matched },
      })
    }
    result.push({
      ...feature,
      geometry: { ...feature.geometry, coordinates: remaining },
    })
  }

  return result
}
