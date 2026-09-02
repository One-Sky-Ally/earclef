/**
 * Reader for the local MusicBrainz artist-link index built by
 * scripts/build-mb-artist-index.mjs.
 *
 * Its whole job is to answer "what is this MusicBrainz artist's Discogs
 * id?" WITHOUT name matching. Discogs is a separate ID space, and
 * crossing it by name is what quarantined 3,907 gap-fill links; this
 * returns MusicBrainz's own curated `discogs` URL relation or nothing
 * at all. Nothing is the correct, safe answer — it means the caller
 * must not guess.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = 'data/mb-dump/artist-links'
const META_PATH = 'data/mb-dump/artist-index-meta.json'

const shardCache = new Map()

export function artistLinksAvailable() {
  return existsSync(META_PATH) && existsSync(OUT_DIR)
}

export function artistLinksSnapshot() {
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
      try {
        const row = JSON.parse(line)
        byArtist.set(row.a, row)
      } catch {
        // A single bad line must not blind the whole shard.
      }
    }
  }
  shardCache.set(prefix, byArtist)
  return byArtist
}

/**
 * The artist's Discogs id, or null when MusicBrainz records none.
 *
 * Returns null too when the artist has SEVERAL Discogs relations:
 * ambiguity is not identity, and picking one would be exactly the kind
 * of silent guess the id-level crosswalk exists to prevent. Those cases
 * are visible via `discogsIdsFor` if a future pass wants to rule on
 * them deliberately.
 */
export function discogsIdFor(mbid) {
  const ids = discogsIdsFor(mbid)
  return ids.length === 1 ? ids[0] : null
}

export function discogsIdsFor(mbid) {
  if (typeof mbid !== 'string' || mbid.length !== 36) return []
  return loadShard(mbid.slice(0, 2)).get(mbid)?.dg ?? []
}

/** The artist's YouTube channel URLs — banked for the queue resolver. */
export function youtubeUrlsFor(mbid) {
  if (typeof mbid !== 'string' || mbid.length !== 36) return []
  return loadShard(mbid.slice(0, 2)).get(mbid)?.yt ?? []
}

/**
 * The artist's Wikidata QIDs — the ID-level bridge to Discogs for
 * artists MusicBrainz never linked directly (a Wikidata item carries
 * both P434, the MB id, and P1953, the Discogs id). Proven on the
 * founding Racciatti case.
 */
export function wikidataQidsFor(mbid) {
  if (typeof mbid !== 'string' || mbid.length !== 36) return []
  return loadShard(mbid.slice(0, 2)).get(mbid)?.wd ?? []
}
