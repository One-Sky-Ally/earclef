/**
 * Place-year pools rebuilt the way countryDetails() builds them: the
 * stored rosters (countries, US states, UK nations, plus historical-area
 * artists), active that year, undated artists only from 1980, dated
 * first and then by weight, top 300. Origin corrections and self-filed
 * pins are left out; both are tiny next to the stored rosters.
 * Shared by the measurement and build scripts that need every pool.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const POOL_LIMIT = 300
export const UNDATED_FLOOR = 1980

export function loadPlaces(ROOT = process.cwd()) {
  const places = new Map()
  const countryDir = join(ROOT, 'lib/explore/country-artists')
  for (const file of readdirSync(countryDir)) {
    const stored = JSON.parse(readFileSync(join(countryDir, file), 'utf8'))
    places.set(file.replace('.json', ''), { name: stored.name, artists: stored.artists })
  }
  for (const file of ['state-artists.json', 'uk-nation-artists.json']) {
    const stored = JSON.parse(readFileSync(join(ROOT, 'lib/explore', file), 'utf8'))
    for (const [code, region] of Object.entries(stored.states)) {
      places.set(code, { name: code, artists: region.artists })
    }
  }
  const historical = JSON.parse(readFileSync(join(ROOT, 'lib/explore/historical-area-artists.json'), 'utf8'))
  for (const [code, list] of Object.entries(historical.countries)) {
    const place = places.get(code)
    if (!place) continue
    const held = new Set(place.artists.map((artist) => artist.id))
    const extra = list
      .filter((artist) => !held.has(artist.mbid))
      .map((artist) => ({ id: artist.mbid, name: artist.name, cs: artist.lifeBegin ?? null, end: artist.lifeEnd ?? null, w: artist.votes ?? 0 }))
    places.set(code, { ...place, artists: [...place.artists, ...extra] })
  }
  return places
}

/** Calls visit(code, year, orderedPoolArtists) for every place-year. */
export function walkPools(places, visit) {
  for (const [code, place] of places) {
    const ordered = [
      ...place.artists.filter((artist) => artist.cs !== null).sort((a, b) => b.w - a.w),
      ...place.artists.filter((artist) => artist.cs === null).sort((a, b) => b.w - a.w),
    ]
    for (let year = 1900; year <= 2026; year++) {
      const pool = []
      for (const artist of ordered) {
        if (pool.length >= POOL_LIMIT) break
        if (artist.cs !== null && artist.cs > year) continue
        if (artist.end !== null && artist.end < year) continue
        if (artist.cs === null && year < UNDATED_FLOOR) continue
        pool.push(artist)
      }
      if (pool.length > 0) visit(code, year, pool)
    }
  }
}

