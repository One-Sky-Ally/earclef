/**
 * Pool entries the owner's rulings moved OUT of lib/explore/extra-artists.json
 * into a held file. A sweep's top-up merge appends any artist the
 * committed list does not already hold — so without this, the next
 * sweep would quietly put every held artist back (standing lesson 2:
 * the persisted decision is the decision, and it must outlive the pass).
 *
 * Two held files move pool entries today:
 *   data/origin-held.json         foreign-catalog entries with no ruling
 *                                 (owner, Sep 28 2026 — origin rule)
 *   data/mb-duplicates-held.json  cases with moved: 'pool' (owner, Sep 22
 *                                 2026 — the MB copy was kept)
 * Keyed by pool country + Discogs id: the same artist may legitimately
 * sit in another pool, and only the ruled pair is held.
 */
import { existsSync, readFileSync } from 'node:fs'

const ORIGIN_HELD_PATH = 'data/origin-held.json'
const MB_DUPLICATES_HELD_PATH = 'data/mb-duplicates-held.json'

/** Map of pool country → Set of held Discogs ids (as strings). */
export function heldPoolIds() {
  const held = new Map()
  const add = (code, id) => {
    if (!code || id == null) return
    if (!held.has(code)) held.set(code, new Set())
    held.get(code).add(String(id))
  }
  if (existsSync(ORIGIN_HELD_PATH)) {
    const file = JSON.parse(readFileSync(ORIGIN_HELD_PATH, 'utf8'))
    for (const item of file.cases ?? []) add(item.country, item.discogsArtistId)
  }
  if (existsSync(MB_DUPLICATES_HELD_PATH)) {
    const file = JSON.parse(readFileSync(MB_DUPLICATES_HELD_PATH, 'utf8'))
    for (const item of file.cases ?? []) {
      if (item.moved === 'pool' || String(item.moved).startsWith('pool ')) {
        add(item.country, item.discogsArtistId)
      }
    }
  }
  return held
}
