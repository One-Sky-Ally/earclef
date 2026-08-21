import statesConfig from './us-states.json'
import nationsConfig from './uk-nations.json'

/**
 * Subdivided regions — the globe's zoomed-in layer. The 50 US states
 * + DC and the four UK nations. Companion to subdivisions.ts (offshore
 * polygon carving); regions instead come from their own geojson and
 * appear at close zoom. Panels are served from the committed
 * precomputed datasets (lib/explore/state-artists.json,
 * uk-nation-artists.json), not live MusicBrainz — a region whose
 * dataset hasn't landed yet degrades to the live MB area query.
 */

export interface Region {
  /** ISO 3166-2 code, e.g. US-NV, GB-SCT. */
  code: string
  name: string
}

interface RegionConfig {
  states: { code: string; name: string; aliases?: string[] }[]
}

const CONFIGS: RegionConfig[] = [statesConfig, nationsConfig]

export const US_STATES: Region[] = statesConfig.states.map((state) => ({
  code: state.code,
  name: state.name,
}))

export const UK_NATIONS: Region[] = nationsConfig.states.map((nation) => ({
  code: nation.code,
  name: nation.name,
}))

export const SUBDIVIDED_REGIONS: Region[] = [...US_STATES, ...UK_NATIONS]

/** US states use 2-letter suffixes, UK nations 3 (GB-ENG, GB-SCT…). */
export const REGION_CODE_PATTERN = /^(?:US-[A-Z]{2}|GB-[A-Z]{3})$/

const byCode = new Map(SUBDIVIDED_REGIONS.map((region) => [region.code, region]))

const byName = new Map<string, Region>()
for (const config of CONFIGS) {
  for (const entry of config.states) {
    const region = { code: entry.code, name: entry.name }
    byName.set(entry.name.toLowerCase(), region)
    for (const alias of entry.aliases ?? []) {
      byName.set(alias.toLowerCase(), region)
    }
  }
}

export function regionByCode(code: string): Region | undefined {
  return byCode.get(code)
}

export function regionByName(name: string): Region | undefined {
  return byName.get(name.trim().toLowerCase())
}
