/**
 * STAGE 4 BUILD — distill the era-dating corrections into the committed
 * serving dataset (owner-approved Sep 1, 2026: "Go. Commit the 8.8 MB
 * as you recommend — same pattern as country-artists, no new runtime
 * dependency.").
 *
 * Input:  data/rg-dating-corrections.json (gitignored working data —
 *         full provenance: tiers, Discogs ids, verdict detail)
 * Output: lib/explore/rg-dating/<xx>.json — 256 shards by artist-MBID
 *         prefix, COMMITTED, holding only what the routes read:
 *           { [artistMbid]: { s: {titleKey: year},          // songs
 *                             a: {rgId: [lo, hi]} } }       // retro spans
 *         plus index.json carrying the dataset VERSION — a content hash
 *         that queue-cache entries record, so a corrections refresh
 *         lazily invalidates exactly the artists it touches and nobody
 *         else (no GATE_PASS storm, no quota spike).
 *
 * Only RETROSPECTIVE album verdicts ship: `current` and `no-evidence`
 * mean "keep MusicBrainz's year", which is what the routes do for any
 * group absent from the dataset — absence IS the verdict.
 *
 * Usage: node scripts/build-rg-dating-apply.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = 'data/rg-dating-corrections.json'
const OUT_DIR = 'lib/explore/rg-dating'
const INDEX_PATH = join(OUT_DIR, 'index.json')

const corrections = JSON.parse(readFileSync(SOURCE, 'utf8'))

const perArtist = new Map()
let songs = 0
for (const [artistId, bucket] of Object.entries(corrections.songYears)) {
  const s = {}
  for (const [key, value] of Object.entries(bucket)) {
    s[key] = value.y
    songs += 1
  }
  perArtist.set(artistId, { s, a: {} })
}
let albums = 0
for (const [rgId, album] of Object.entries(corrections.albums)) {
  if (album.verdict !== 'retrospective' || !album.span) continue
  albums += 1
  for (const artistId of album.artistIds ?? []) {
    let entry = perArtist.get(artistId)
    if (!entry) {
      entry = { s: {}, a: {} }
      perArtist.set(artistId, entry)
    }
    entry.a[rgId] = album.span
  }
}

// Deterministic serialization → stable content hash across rebuilds of
// identical data (key order fixed by sorting).
const shards = new Map()
for (const [artistId, entry] of [...perArtist.entries()].sort()) {
  const prefix = artistId.slice(0, 2)
  const shard = shards.get(prefix) ?? {}
  shard[artistId] = {
    s: Object.fromEntries(Object.entries(entry.s).sort()),
    a: Object.fromEntries(Object.entries(entry.a).sort()),
  }
  shards.set(prefix, shard)
}

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

const hash = createHash('sha256')
let bytes = 0
for (const [prefix, shard] of [...shards.entries()].sort()) {
  const body = JSON.stringify(shard)
  hash.update(prefix).update(body)
  bytes += Buffer.byteLength(body)
  writeFileSync(join(OUT_DIR, `${prefix}.json`), body + '\n')
}
const version = hash.digest('hex').slice(0, 12)

writeFileSync(
  INDEX_PATH,
  JSON.stringify(
    {
      version,
      builtAt: new Date().toISOString(),
      artists: perArtist.size,
      songs,
      retrospectiveAlbums: albums,
      shards: [...shards.keys()].sort(),
    },
    null,
    2,
  ) + '\n',
)

console.log(
  `rg-dating serving dataset: ${perArtist.size.toLocaleString()} artists · ${songs.toLocaleString()} songs · ${albums.toLocaleString()} retro albums`,
)
console.log(
  `${shards.size} shards · ${(bytes / 1048576).toFixed(1)} MB · version ${version}`,
)
