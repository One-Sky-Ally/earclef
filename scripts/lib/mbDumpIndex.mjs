/**
 * Reader for the local MusicBrainz release-group index built by
 * scripts/build-mb-dump-index.mjs. Turns what used to be a 1.1 req/s
 * API walk into a file read.
 *
 * Shards are loaded lazily and cached: a sweep that walks artists in
 * roster order touches each of the 256 shards a handful of times, so
 * caching them turns thousands of file reads into 256.
 *
 * SHAPE PARITY IS DELIBERATE. `releaseGroupsFor` returns rows in the
 * SAME shape the MusicBrainz web service returns (`first-release-date`,
 * `primary-type`, `secondary-types`), so a consumer can switch between
 * the live API and this index without a second code path to keep
 * correct. The compact on-disk keys exist to keep the index small; they
 * are expanded here and nowhere else.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = 'data/mb-dump/rg-by-artist'
const META_PATH = 'data/mb-dump/index-meta.json'

const shardCache = new Map()

export function dumpIndexAvailable() {
  return existsSync(META_PATH) && existsSync(OUT_DIR)
}

/** Which snapshot a run derived its answers from — always report this. */
export function dumpSnapshot() {
  try {
    return JSON.parse(readFileSync(META_PATH, 'utf8'))
  } catch {
    return null
  }
}

function loadShard(prefix) {
  const cached = shardCache.get(prefix)
  if (cached) return cached
  const path = join(OUT_DIR, `${prefix}.jsonl`)
  const byArtist = new Map()
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      const held = byArtist.get(row.a)
      if (held) held.push(row)
      else byArtist.set(row.a, [row])
    }
  }
  shardCache.set(prefix, byArtist)
  return byArtist
}

/**
 * Every release group credited to this artist, in web-service shape.
 * An artist the dump has nothing for returns [] — which is a real
 * answer (they have no release groups), NOT a lookup failure. Callers
 * that need to tell those apart should check dumpIndexAvailable first.
 */
export function releaseGroupsFor(mbid) {
  if (typeof mbid !== 'string' || mbid.length !== 36) return []
  const rows = loadShard(mbid.slice(0, 2)).get(mbid) ?? []
  return rows.map((row) => ({
    id: row.i,
    title: row.t,
    'first-release-date': row.d || undefined,
    'primary-type': row.p ?? undefined,
    'secondary-types': row.s ?? [],
  }))
}

/** Frees the shard cache — for long sweeps that walk every shard. */
export function clearShardCache() {
  shardCache.clear()
}
