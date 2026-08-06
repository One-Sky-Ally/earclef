import statesConfig from './us-states.json'

/**
 * The 50 US states + DC — the globe's zoomed-in layer for the United
 * States. Companion to subdivisions.ts (offshore polygon carving);
 * states instead come from their own geojson and appear at close zoom.
 * Panels are served from the committed precomputed dataset
 * (lib/explore/state-artists.json), not live MusicBrainz.
 */

export interface UsState {
  /** ISO 3166-2 code, e.g. US-NV. */
  code: string
  name: string
}

export const US_STATES: UsState[] = statesConfig.states.map((state) => ({
  code: state.code,
  name: state.name,
}))

export const US_STATE_CODE_PATTERN = /^US-[A-Z]{2}$/

const byCode = new Map(US_STATES.map((state) => [state.code, state]))

const byName = new Map<string, UsState>()
for (const state of statesConfig.states) {
  const entry = { code: state.code, name: state.name }
  byName.set(state.name.toLowerCase(), entry)
  for (const alias of (state as { aliases?: string[] }).aliases ?? []) {
    byName.set(alias.toLowerCase(), entry)
  }
}

export function usStateByCode(code: string): UsState | undefined {
  return byCode.get(code)
}

export function usStateByName(name: string): UsState | undefined {
  return byName.get(name.trim().toLowerCase())
}
