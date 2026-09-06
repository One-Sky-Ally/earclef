/**
 * Reader for the local MusicBrainz AREA index built by
 * scripts/build-mb-area-index.mjs — the dedup rule's area walk as a
 * map lookup instead of one API call per hop.
 *
 * `areaChain(areaId)` returns the area and its ancestors, root-most
 * last, following exactly the relation the API walk followed (`part
 * of`, direction `backward`). Unknown ids return [] — a real answer
 * for the caller to treat as 'unknown', never as a match.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const INDEX_PATH = join(
  process.env.EARCLEF_MB_DUMP_DIR ?? 'data/mb-dump',
  'area-parents.json',
)
const MAX_DEPTH = 12

let loaded = null

function load() {
  if (loaded !== null) return loaded
  loaded = existsSync(INDEX_PATH)
    ? JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
    : false
  return loaded
}

export function areaIndexAvailable() {
  const index = load()
  return Boolean(index && index.areas)
}

export function areaIndexMeta() {
  const index = load()
  if (!index) return null
  const { areas, ...meta } = index
  return meta
}

/** [{id, name, type, isoCodes}] from the area upward; [] if unknown. */
export function areaChain(areaId) {
  const index = load()
  if (!index || typeof areaId !== 'string') return []
  const chain = []
  const seen = new Set()
  let current = areaId
  while (current && chain.length < MAX_DEPTH && !seen.has(current)) {
    seen.add(current)
    const row = index.areas[current]
    if (!row) break
    const [name, type, parentId, isoCodes] = row
    chain.push({ id: current, name, type, isoCodes: isoCodes ?? [] })
    current = parentId
  }
  return chain
}
