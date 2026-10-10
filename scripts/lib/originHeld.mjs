/**
 * Pool entries the owner's rulings moved OUT of lib/explore/extra-artists.json
 * into a held file. A sweep's top-up merge appends any artist the
 * committed list does not already hold — so without this, the next
 * sweep would quietly put every held artist back (standing lesson 2:
 * the persisted decision is the decision, and it must outlive the pass).
 *
 * Three held files move pool entries today:
 *   data/origin-held.json         foreign-catalog entries with no ruling
 *                                 (owner, Sep 28 2026 — origin rule)
 *   data/mb-duplicates-held.json  cases with moved: 'pool' (owner, Sep 22
 *                                 2026 — the MB copy was kept)
 *   data/occupation-held.json     entries held for the owner's ear (owner,
 *                                 Oct 10 2026 — the three Uzbek ashiks)
 * Keyed by pool country + Discogs id, or + Wikidata id for entries with
 * no Discogs id: the same artist may legitimately sit in another pool,
 * and only the ruled pair is held.
 */
import { existsSync, readFileSync } from 'node:fs'

const DEFAULT_PATHS = {
  origin: 'data/origin-held.json',
  mbDuplicates: 'data/mb-duplicates-held.json',
  occupation: 'data/occupation-held.json',
}

const readCases = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).cases ?? [] : [])

/**
 * Map of pool country → Set of held keys: Discogs ids as strings, and
 * `wd:<QID>` for Wikidata-only entries (data/occupation-held.json —
 * owner, Oct 10 2026), which have no Discogs id to key on.
 */
export function heldPoolIds(paths = DEFAULT_PATHS) {
  const { origin, mbDuplicates, occupation } = { ...DEFAULT_PATHS, ...paths }
  const held = new Map()
  const add = (code, key) => {
    if (!code || key == null || key === '') return
    if (!held.has(code)) held.set(code, new Set())
    held.get(code).add(String(key))
  }
  for (const item of readCases(origin)) add(item.country, item.discogsArtistId)
  for (const item of readCases(mbDuplicates)) {
    if (item.moved === 'pool' || String(item.moved).startsWith('pool ')) {
      add(item.country, item.discogsArtistId)
    }
  }
  for (const item of readCases(occupation)) {
    add(item.country, item.discogsArtistId)
    if (item.wikidataId) add(item.country, `wd:${item.wikidataId}`)
  }
  return held
}

/** Is this pool entry held in this country? Absent ids never match. */
export function isHeldInPool(held, code, artist) {
  const here = held.get(code)
  if (!here) return false
  if (artist.discogsArtistId != null && here.has(String(artist.discogsArtistId))) return true
  return Boolean(artist.wikidataId) && here.has(`wd:${artist.wikidataId}`)
}
