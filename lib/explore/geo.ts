export interface CountryFeature {
  properties: { ADMIN: string; ISO_A2: string }
}

// Natural Earth marks some territories -99; map the ones MusicBrainz knows.
const ISO_FIXES: Record<string, string> = { France: 'FR', Norway: 'NO' }

export function isoOf(feature: CountryFeature): string | undefined {
  const { ISO_A2, ADMIN } = feature.properties
  if (/^[A-Z]{2}$/.test(ISO_A2)) return ISO_A2
  return ISO_FIXES[ADMIN]
}
