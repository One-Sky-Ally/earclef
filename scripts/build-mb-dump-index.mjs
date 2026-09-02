/**
 * LOCAL MUSICBRAINZ RELEASE-GROUP INDEX (owner-approved Aug 31, 2026).
 *
 * WHY THIS EXISTS. Nearly every large job on this project has been
 * throttle-bound against MusicBrainz's 1 req/s courtesy limit: the
 * country precompute took 8 passes, the gap-fill crosswalk 15,381
 * entries at 4.53s each (~19h, six launches, one outage-lost window),
 * and the era-dating census was scoped at 15.7 hours for 23,580
 * artists. This turns all of that into a local file read.
 *
 * WHAT IT READS. MetaBrainz's JSON entity dump for release groups
 * (data.metabrainz.org .../json-dumps/<stamp>/release-group.tar.xz,
 * ~1 GB). Each line is one release group carrying exactly what the
 * sweeps need INLINE — `first-release-date`, `primary-type`,
 * `secondary-types` and `artist-credit[].artist.id` — so there is no
 * schema to parse, no column order to get wrong and no joins. The data
 * is CC0. Chosen over the 6.96 GB `mbdump.tar.bz2` for that reason:
 * one seventh the download and none of the TSV column-order risk.
 *
 * macOS ships both `bsdtar -J` and Python's lzma, so nothing new has to
 * be installed — the no-new-dependencies constraint holds. (`xz` itself
 * is NOT present on this machine; do not reach for it.)
 *
 * WHAT IT WRITES. data/mb-dump/rg-by-artist/<xx>.jsonl — 256 shards
 * keyed by the first two hex characters of the CREDITED ARTIST's MBID,
 * one compact record per (artist, release group) pair. Sharding keeps a
 * lookup to a single small file instead of a 4.5M-row scan, and mirrors
 * the per-country sharding the roster data already uses.
 *
 * WHAT IT IS NOT. This is OFFLINE TOOLING, not serving infrastructure —
 * the live site keeps its cached-API request path untouched. The index
 * is a dated snapshot: fine for historical eras (a 1964 release does
 * not change), wrong for anything needing today's data. Every consumer
 * records which snapshot it used.
 *
 * Usage:
 *   node scripts/build-mb-dump-index.mjs                # build/refresh
 *   node scripts/build-mb-dump-index.mjs --verify       # stats only
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

import { join } from 'node:path'

const DUMP_DIR = 'data/mb-dump'
const ARCHIVE = join(DUMP_DIR, 'release-group.tar.xz')
const MEMBER = 'mbdump/release-group'
const OUT_DIR = join(DUMP_DIR, 'rg-by-artist')
const META_PATH = join(DUMP_DIR, 'index-meta.json')
/** Progress line every N records — 4.5M records is a long silence. */
const PROGRESS_EVERY = 250_000

const verifyOnly = process.argv.includes('--verify')

/** Two hex chars of the artist MBID → 256 shards. */
const shardOf = (mbid) => mbid.slice(0, 2)

/**
 * One metadata member out of the archive. The dump carries TIMESTAMP,
 * SCHEMA_SEQUENCE and REPLICATION_SEQUENCE; recording all three is what
 * makes "which snapshot did this answer come from, and does its schema
 * still match the live one?" answerable months later.
 */
function readMember(name) {
  return new Promise((resolve) => {
    try {
      const child = spawn('tar', ['-xJOf', ARCHIVE, name])
      let buf = ''
      child.stdout.on('data', (chunk) => (buf += chunk))
      // tar exits non-zero on a truncated archive after emitting what
      // it found, so the VALUE is what matters here, not the code.
      child.on('close', () => resolve(buf.trim() || 'unknown'))
      child.on('error', () => resolve('unknown'))
    } catch {
      resolve('unknown')
    }
  })
}

function verify() {
  if (!existsSync(OUT_DIR)) {
    console.log('No index built yet.')
    return
  }
  const shards = readdirSync(OUT_DIR).filter((f) => f.endsWith('.jsonl'))
  let bytes = 0
  let rows = 0
  for (const shard of shards) {
    const path = join(OUT_DIR, shard)
    bytes += statSync(path).size
    rows += readFileSync(path, 'utf8').split('\n').filter(Boolean).length
  }
  const meta = existsSync(META_PATH)
    ? JSON.parse(readFileSync(META_PATH, 'utf8'))
    : null
  console.log(`shards: ${shards.length}`)
  console.log(`rows:   ${rows.toLocaleString()}`)
  console.log(`size:   ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  if (meta) {
    console.log(`snapshot: ${meta.snapshot}`)
    console.log(`built:    ${meta.builtAt}`)
    console.log(`artists:  ${meta.artists.toLocaleString()}`)
  }
}

async function build() {
  if (!existsSync(ARCHIVE)) {
    throw new Error(`Missing ${ARCHIVE} — download it first.`)
  }
  const [snapshot, schema, replication] = await Promise.all([
    readMember('TIMESTAMP'),
    readMember('SCHEMA_SEQUENCE'),
    readMember('REPLICATION_SEQUENCE'),
  ])
  console.log(`archive : ${ARCHIVE} (${(statSync(ARCHIVE).size / 1024 ** 3).toFixed(2)} GB)`)
  console.log(`snapshot: ${snapshot} · schema ${schema} · replication ${replication}`)

  // Rebuild from clean so a refresh cannot leave half of an older
  // snapshot behind — the shards are derived data, never accumulated.
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const streams = new Map()
  const writeRow = (shard, line) => {
    let stream = streams.get(shard)
    if (!stream) {
      stream = createWriteStream(join(OUT_DIR, `${shard}.jsonl`))
      streams.set(shard, stream)
    }
    return stream.write(line)
  }

  const child = spawn('tar', ['-xJOf', ARCHIVE, MEMBER])
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.warn(`  tar: ${text}`)
  })

  /**
   * Split on \n ONLY — do not reach for readline here.
   *
   * readline also breaks on a lone \r, and a handful of release-group
   * records carry one in a way that is legal inside their JSON. Against
   * this exact archive readline saw 4,486,348 lines and choked on 32
   * fragments; splitting on \n alone sees 4,486,319 lines and parses
   * EVERY ONE. The 32 "malformed" lines were readline's own doing, and
   * skipping them silently discarded ~3 real records.
   */
  child.stdout.setEncoding('utf8')

  let records = 0
  let written = 0
  let malformed = 0
  const artists = new Set()

  const handleLine = async (line) => {
    if (!line) return
    records += 1
    let rg
    try {
      rg = JSON.parse(line)
    } catch {
      malformed += 1
      return
    }
    const date = rg['first-release-date'] ?? ''
    const secondary = rg['secondary-types'] ?? []
    // One row per credited artist: a split release belongs to each of
    // them, and a sweep keyed on one artist must still find it.
    //
    // DEDUPED WITHIN THE RELEASE GROUP, and the reason is a real bug the
    // Uruguay validation gate caught: an artist can appear MORE THAN
    // ONCE in one credit array — José Serebrier's "Serebrier Conducts
    // Serebrier" credits him as composer and as conductor — which
    // emitted two identical rows and made the index report 76 groups
    // where MusicBrainz reports 73. Left in, it would have inflated
    // every count and double-counted candidates in the census.
    const creditedHere = new Set()
    for (const credit of rg['artist-credit'] ?? []) {
      const artistId = credit?.artist?.id
      // Missing is not a match — a credit with no artist id indexes
      // nothing and must not become an empty-string shard key.
      if (typeof artistId !== 'string' || artistId.length !== 36) continue
      if (creditedHere.has(artistId)) continue
      creditedHere.add(artistId)
      artists.add(artistId)
      const row = {
        a: artistId,
        i: rg.id,
        t: rg.title ?? '',
        d: date,
        p: rg['primary-type'] ?? null,
        ...(secondary.length > 0 ? { s: secondary } : {}),
      }
      const ok = writeRow(shardOf(artistId), JSON.stringify(row) + '\n')
      written += 1
      if (!ok) {
        // Respect backpressure or a 4.5M-row stream buries the heap.
        await new Promise((resolve) =>
          streams.get(shardOf(artistId)).once('drain', resolve),
        )
      }
    }
    if (records % PROGRESS_EVERY === 0) {
      console.log(
        `  ${records.toLocaleString()} release groups · ${written.toLocaleString()} rows · ${artists.size.toLocaleString()} artists`,
      )
    }
  }

  // Manual chunk buffering: pause the stream while a line is being
  // handled so backpressure inside handleLine actually holds the
  // producer back, then resume.
  const exitCode = await new Promise((resolve, reject) => {
    let pending = ''
    let chain = Promise.resolve()
    child.stdout.on('data', (chunk) => {
      const parts = (pending + chunk).split('\n')
      pending = parts.pop() ?? ''
      if (parts.length === 0) return
      child.stdout.pause()
      chain = chain
        .then(async () => {
          for (const line of parts) await handleLine(line)
        })
        .then(() => child.stdout.resume())
        .catch(reject)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      chain
        .then(async () => {
          if (pending) await handleLine(pending)
        })
        .then(() => resolve(code))
        .catch(reject)
    })
  })
  await Promise.all(
    [...streams.values()].map(
      (stream) => new Promise((resolve) => stream.end(resolve)),
    ),
  )

  if (exitCode !== 0) {
    throw new Error(
      `tar exited ${exitCode} after ${records} records — index is INCOMPLETE, not written as valid.`,
    )
  }

  writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        snapshot,
        schemaSequence: schema,
        replicationSequence: replication,
        builtAt: new Date().toISOString(),
        source:
          'data.metabrainz.org json-dumps release-group (CC0)',
        releaseGroups: records,
        rows: written,
        artists: artists.size,
        malformed,
      },
      null,
      2,
    ) + '\n',
  )

  console.log(
    `\nDONE — ${records.toLocaleString()} release groups → ${written.toLocaleString()} rows across ${streams.size} shards, ${artists.size.toLocaleString()} distinct artists${malformed > 0 ? `, ${malformed} malformed lines skipped` : ''}.`,
  )
  verify()
}

if (verifyOnly) {
  verify()
} else {
  build().catch((error) => {
    console.error('mb-dump index build failed:', error.message)
    process.exit(1)
  })
}
