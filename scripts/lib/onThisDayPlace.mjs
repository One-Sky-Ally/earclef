/**
 * Where an "On this day" song was MADE (owner, Oct 11 2026): "where it
 * was recorded, or where the artist was based and making music at the
 * time. Not where the artist was born, and not where the record was
 * merely released. … Only show what's verified."
 *
 * The verified, time-specific source is MusicBrainz's own "recorded at"
 * (place) and "recorded in" (area) relationships — on the song's
 * recording, or on the whole release — resolved through MusicBrainz's
 * area hierarchy (data/mb-dump/area-parents.json). Every link is an id.
 * A release's country of issue is never used (that is where a record
 * was released), nor an artist's birthplace.
 *
 * Pure: scripts/build-on-this-day-places.mjs feeds it.
 */

/** Area types that name a city on the record. */
const CITY_TYPES = new Set(['City', 'Municipality'])

/**
 * An area chain (the area, then its parents) → { city, country,
 * countryName, sub? }. The city is the first City/Municipality going up
 * (a District resolves to its city; a state alone gives no city). `sub`
 * is the globe's own code for a US state or UK nation in the chain, when
 * the site draws one. No country in the chain → null.
 */
export function placeOfChain(chain, subdivisions = {}) {
  const country = chain.find((entry) => entry.type === 'Country' && entry.isoCodes?.length)
  if (!country) return null
  const code = country.isoCodes[0].slice(0, 2)
  const city = chain.find((entry) => CITY_TYPES.has(entry.type))?.name ?? null
  const named = subdivisions[code] ?? {}
  const sub = chain.filter((entry) => entry.type === 'Subdivision').map((entry) => named[entry.name]).find(Boolean)
  return { city, country: code, countryName: country.name, ...(sub ? { sub } : {}) }
}

/**
 * One place out of several statements: the same city → that place; cities
 * that differ inside one country → the country alone; different
 * countries → nothing (the record does not say one place).
 */
export function agreedPlace(places) {
  const known = places.filter(Boolean)
  if (known.length === 0) return null
  const [first] = known
  if (!known.every((place) => place.country === first.country)) return null
  const sameCity = known.every((place) => place.city === first.city)
  const sameSub = known.every((place) => place.sub === first.sub)
  return {
    city: sameCity ? first.city : null,
    country: first.country,
    countryName: first.countryName,
    ...(sameSub && first.sub ? { sub: first.sub } : {}),
  }
}

/** The title key recordings are grouped under (the queue route's normalize). */
export const songKey = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * The place for one song of a release group: its own recording's
 * statements first, the release-wide ones only when the song has none.
 */
export function songPlace(group, songTitle) {
  if (!group) return null
  const ownRecording = agreedPlace(group.tracks?.[songKey(songTitle)] ?? [])
  if (ownRecording) return { ...ownRecording, basis: 'recording' }
  const wholeRelease = agreedPlace(group.release ?? [])
  return wholeRelease ? { ...wholeRelease, basis: 'release' } : null
}
