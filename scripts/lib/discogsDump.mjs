/**
 * Reader for the local Discogs dump index built by
 * scripts/build-discogs-dump-index.py (owner go, Sep 6, 2026).
 *
 * The index is the monthly CC0 dump sharded by the release's OWN
 * <country> string — the same field the record-level guard compared —
 * so `releasesFor('Ethiopia')` is every release Discogs files there,
 * undated ones included, with structured credits, and no search layer
 * in between to lose a fifth of them (see the Sep 6 pagination
 * finding in the handoff).
 *
 * An index whose meta says complete=false (truncated stream, --limit)
 * is refused: a partial catalog served as the catalog is exactly the
 * silent-truncation failure the sweep's loud CAP warning exists for.
 *
 * Rows are expanded from the compact on-disk keys HERE and nowhere
 * else; consumers see readable names.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const INDEX_DIR =
  process.env.EARCLEF_DISCOGS_INDEX_DIR ?? 'data/discogs-dump/index'
const ARTIST_SHARD_CACHE_MAX = 24

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

export function releasesMeta() {
  return readJson(join(INDEX_DIR, 'releases-meta.json'))
}

export function artistsMeta() {
  return readJson(join(INDEX_DIR, 'artists-meta.json'))
}

export function releaseIndexAvailable() {
  const meta = releasesMeta()
  return Boolean(meta && meta.complete)
}

export function artistIndexAvailable() {
  const meta = artistsMeta()
  return Boolean(meta && meta.complete)
}

/** { <country string>: {slug, total, dated, undated, byYear} } */
export function countryCounts() {
  const table = readJson(join(INDEX_DIR, 'countries.json'))
  return table?.countries ?? {}
}

export function slugForCountry(country) {
  return countryCounts()[country]?.slug ?? null
}

function expandRelease(row) {
  return {
    id: row.i,
    title: row.t,
    country: row.c ?? null,
    year: row.y ?? null,
    released: row.r ?? null,
    artists: (row.a ?? []).map((credit) => ({
      id: credit.i,
      name: credit.n,
      anv: credit.v ?? null,
    })),
    labels: (row.l ?? []).map(([name, catno]) => ({ name, catno })),
    formats: row.f ?? [],
    formatDescriptions: row.fd ?? [],
    genres: row.g ?? [],
    styles: row.s ?? [],
    tracks: row.k ?? [],
    // [{name, role}] — role is Discogs's entity_type_name ("Pressed By",
    // "Recorded At", …); absent on indexes built before Sep 7, 2026.
    companies: (row.co ?? []).map(([name, role]) => ({ name, role })),
    masterId: row.m ?? null,
  }
}

function readGzJsonl(path) {
  if (!existsSync(path)) return []
  const text = gunzipSync(readFileSync(path)).toString('utf8')
  const rows = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      // A torn line can only come from a build that was not completed;
      // releaseIndexAvailable() already refuses those.
    }
  }
  return rows
}

/**
 * Every release whose own country field equals `country`, expanded.
 * Throws when the index is incomplete — never serve a partial catalog.
 */
export function releasesFor(country) {
  if (!releaseIndexAvailable()) {
    throw new Error(
      'Discogs release index missing or incomplete — build it with scripts/build-discogs-dump-index.py',
    )
  }
  const slug = slugForCountry(country)
  if (!slug) return []
  return readGzJsonl(join(INDEX_DIR, 'releases-by-country', `${slug}.jsonl.gz`)).map(
    expandRelease,
  )
}

/**
 * Does this release name one of the slice's plants? Company names are
 * matched by prefix (Discogs files the Tashkent plant under its full
 * honorific name, a short form, and its print shop); the role is not
 * consulted, since the same plant appears as "Pressed By",
 * "Manufactured By" or "Printed By" across eras.
 */
export function plantMatches(release, slice) {
  return (release.companies ?? []).some((company) =>
    slice.pressedBy.some((prefix) => company.name.startsWith(prefix)),
  )
}

const sliceCache = new Map()

/** Every release of `slice.country` that names one of its plants (cached). */
export function plantSliceRows(slice) {
  const key = `${slice.country}|${slice.pressedBy.join('|')}`
  if (!sliceCache.has(key)) {
    sliceCache.set(
      key,
      releasesFor(slice.country).filter((release) => plantMatches(release, slice)),
    )
  }
  return sliceCache.get(key)
}

const videoShards = new Map()

export function videoIndexAvailable() {
  const meta = releasesMeta()
  return Boolean(meta && meta.complete && meta.videosByArtist)
}

const YOUTUBE_ID = /[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/

const shardOf = (numeric) => (numeric % 256).toString(16).padStart(2, '0')

/** The identity gatherer's record shape (`shapeRecord` in the API gatherer). */
function expandVideoRelease(row) {
  return {
    kind: 'release',
    id: row.i,
    listedRole: null,
    title: row.t,
    year: row.y ?? null,
    country: row.c ?? null,
    mainRelease: null,
    artists: (row.cs ?? []).map((credit) => ({ id: credit.i, name: credit.n, anv: credit.v ?? '' })),
    extraartists: (row.x ?? []).map(([cid, name, role]) => ({ id: cid, name, role })),
    tracklist: (row.tl ?? []).map(([position, title, duration, artists]) => ({
      position,
      title,
      duration,
      artists: artists ?? [],
      extraartists: [],
    })),
    ...(row.tt ? { tracklistTruncated: true } : {}),
    videos: (row.vs ?? [])
      .map(([url, title, duration]) => {
        const match = url.match(YOUTUBE_ID)
        return { videoId: match?.[1] ?? match?.[2] ?? null, title, duration: duration ?? null, url }
      })
      .filter((video) => video.videoId),
  }
}

/**
 * Release ids of every video-bearing record this Discogs artist is
 * credited on, with the credit kind: 'm' main, 't' track, 'x' extra.
 * Empty when the artist has none — a real answer (check
 * videoIndexAvailable()).
 */
export function videoReleaseRefsFor(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0 || !videoIndexAvailable()) return []
  const shard = shardOf(numeric)
  let map = videoShards.get(shard)
  if (!map) {
    map = new Map()
    for (const row of readGzJsonl(join(INDEX_DIR, 'videos-by-artist', `${shard}.jsonl.gz`))) {
      const list = map.get(row.a)
      const ref = { releaseId: row.r, kind: row.k ?? 'm' }
      if (list) list.push(ref)
      else map.set(row.a, [ref])
    }
    videoShards.set(shard, map)
    if (videoShards.size > ARTIST_SHARD_CACHE_MAX) videoShards.delete(videoShards.keys().next().value)
  }
  return map.get(numeric) ?? []
}

/** Which release shard holds this id — for callers that batch by shard. */
export function videoReleaseShardOf(releaseId) {
  return shardOf(Number(releaseId))
}

/**
 * Every video-bearing release in one shard, id → record. Loading a
 * shard is the expensive step; a sweep that groups its release ids by
 * shard (videoReleaseShardOf) loads each of the 256 shards once.
 */
export function videoReleaseShard(shard) {
  const map = new Map()
  for (const row of readGzJsonl(join(INDEX_DIR, 'video-releases', `${shard}.jsonl.gz`))) {
    map.set(row.i, expandVideoRelease(row))
  }
  return map
}

/**
 * Convenience for one artist (tests, spot checks): every record they
 * are credited on that carries videos, in the gatherer's shape. Sweeps
 * should use videoReleaseRefsFor + videoReleaseShard instead.
 */
export function videosForArtist(id) {
  const refs = videoReleaseRefsFor(id)
  const byShard = new Map()
  for (const ref of refs) {
    const shard = videoReleaseShardOf(ref.releaseId)
    ;(byShard.get(shard) ?? byShard.set(shard, []).get(shard)).push(ref.releaseId)
  }
  const records = []
  for (const [shard, ids] of byShard) {
    const map = videoReleaseShard(shard)
    for (const releaseId of ids) {
      const record = map.get(releaseId)
      if (record) records.push(record)
    }
  }
  return records
}

const artistShards = new Map()

function loadArtistShard(shard) {
  const cached = artistShards.get(shard)
  if (cached) {
    artistShards.delete(shard)
    artistShards.set(shard, cached)
    return cached
  }
  const map = new Map()
  for (const row of readGzJsonl(join(INDEX_DIR, 'artists', `${shard}.jsonl.gz`))) {
    map.set(row.i, row)
  }
  artistShards.set(shard, map)
  if (artistShards.size > ARTIST_SHARD_CACHE_MAX) {
    artistShards.delete(artistShards.keys().next().value)
  }
  return map
}

/** Discogs artist record by id (profile text included); null if absent. */
export function artistRecord(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) return null
  if (!artistIndexAvailable()) return null
  const shard = (numeric % 256).toString(16).padStart(2, '0')
  const row = loadArtistShard(shard).get(numeric)
  if (!row) return null
  return {
    id: row.i,
    name: row.n,
    realName: row.rn ?? null,
    profile: row.p ?? null,
    nameVariations: row.nv ?? [],
    aliases: (row.al ?? []).map((entry) => ({ id: entry.i ?? null, name: entry.n })),
    groups: (row.gr ?? []).map((entry) => ({ id: entry.i ?? null, name: entry.n })),
    members: (row.me ?? []).map((entry) => ({ id: entry.i ?? null, name: entry.n })),
    urls: row.u ?? [],
  }
}
