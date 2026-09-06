/**
 * Reader for the local MusicBrainz NAME index built by
 * scripts/build-mb-name-index.mjs — exact-name candidates for dedup
 * rule v3 without the 1 req/s search API.
 *
 * `artistsNamed(probe)` returns every artist whose name or typed alias
 * normalizes to the probe, in the web-service record shape the rule's
 * judgeNameHit() reads. An empty probe returns [] without touching the
 * index — absent must never match (standing lesson 5).
 *
 * Shards are keyed by a hash of the normalized key and cached in a
 * small LRU: a sweep's probes scatter across all 256 shards, so a
 * bounded cache keeps memory flat while repeated probes stay free.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeName } from './normalizeName.mjs'

const DUMP_DIR = process.env.EARCLEF_MB_DUMP_DIR ?? 'data/mb-dump'
const INDEX_DIR = join(DUMP_DIR, 'artist-names')
const META_PATH = join(DUMP_DIR, 'artist-names-meta.json')
const SHARD_CACHE_MAX = 48

/** Alias types that count as the artist's name (rule v3, point 4). */
export const ALLOWED_ALIAS_TYPES = new Set(['Artist name', 'Legal name'])

/** FNV-1a over the key → two hex chars → 256 shards. */
export function nameShardOf(key) {
  let hash = 0x811c9dc5
  for (const char of key) {
    for (const byte of Buffer.from(char, 'utf8')) {
      hash ^= byte
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return (hash & 0xff).toString(16).padStart(2, '0')
}

let metaCache = null
export function nameIndexMeta() {
  if (metaCache !== null) return metaCache
  metaCache = existsSync(META_PATH)
    ? JSON.parse(readFileSync(META_PATH, 'utf8'))
    : false
  return metaCache
}

export function nameIndexAvailable() {
  const meta = nameIndexMeta()
  return Boolean(meta && meta.complete && existsSync(INDEX_DIR))
}

const shardCache = new Map()

function loadShard(shard) {
  const cached = shardCache.get(shard)
  if (cached) {
    // Refresh LRU order.
    shardCache.delete(shard)
    shardCache.set(shard, cached)
    return cached
  }
  const map = new Map()
  const path = join(INDEX_DIR, `${shard}.jsonl`)
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      const list = map.get(row.k)
      if (list) list.push(row.r)
      else map.set(row.k, [row.r])
    }
  }
  shardCache.set(shard, map)
  if (shardCache.size > SHARD_CACHE_MAX) {
    const oldest = shardCache.keys().next().value
    shardCache.delete(oldest)
  }
  return map
}

/**
 * Every MB artist whose name or typed alias equals the probe under
 * normalizeName. Order is the dump's own (arbitrary); callers that
 * need a preference (same-country first) sort the result themselves.
 */
export function artistsNamed(probe) {
  const key = normalizeName(probe ?? '')
  if (!key) return []
  return loadShard(nameShardOf(key)).get(key) ?? []
}

export function clearNameShardCache() {
  shardCache.clear()
}
