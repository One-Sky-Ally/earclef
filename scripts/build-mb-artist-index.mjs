/**
 * LOCAL MUSICBRAINZ ARTIST INDEX — the ID-level crosswalk layer.
 *
 * WHY THIS EXISTS, and it is an IDENTITY concern before it is a speed
 * one. Stage 2 of the re-dating work asks Discogs "does an older
 * original of this record exist?" — and Discogs is a different ID
 * space. Matching artists by NAME across that boundary is precisely
 * what produced the 3,907 quarantined gap-fill links, and what standing
 * lesson 3 forbids without independent corroboration. MusicBrainz
 * already stores the answer as a URL relation
 * (`{"type":"discogs","url":"https://www.discogs.com/artist/115581"}`),
 * which is ID-level evidence end to end with no name matching anywhere
 * — the same method the gap-fill crosswalk audit used.
 *
 * A 300-artist probe of this dump found 288 Discogs relations, so
 * coverage is high enough to make the ID path the PRIMARY one and leave
 * name-matching as an explicitly-corroborated fallback.
 *
 * It also captures the YouTube channel relation, which is the second
 * per-artist MusicBrainz call the queue resolver makes on every cache
 * miss (see the Aug 29 playback-dependency diagnosis) — banked here for
 * a later session, not wired into anything yet.
 *
 * Writes data/mb-dump/artist-links/<xx>.jsonl, sharded by artist MBID
 * prefix exactly like the release-group index.
 *
 * Usage:
 *   node scripts/build-mb-artist-index.mjs
 *   node scripts/build-mb-artist-index.mjs --verify
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const DUMP_DIR = 'data/mb-dump'
const ARCHIVE = join(DUMP_DIR, 'artist.tar.xz')
const MEMBER = 'mbdump/artist'
const OUT_DIR = join(DUMP_DIR, 'artist-links')
const META_PATH = join(DUMP_DIR, 'artist-index-meta.json')
const PROGRESS_EVERY = 250_000

const verifyOnly = process.argv.includes('--verify')
const shardOf = (mbid) => mbid.slice(0, 2)

/** Discogs artist id out of any of the URL shapes MB stores. */
function discogsArtistId(url) {
  const match = /discogs\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/i.exec(url)
  return match ? match[1] : null
}

/**
 * Wikidata QID. Captured because it is the ID-LEVEL BRIDGE for artists
 * MusicBrainz never linked to Discogs directly: a Wikidata item holds
 * both the MB artist id (P434) and the Discogs artist id (P1953), so
 * MB→Wikidata→Discogs is a pure two-hop with no name anywhere. Proven
 * on the founding case — Donato Racciatti has no discogs relation, but
 * his Q10268281 carries P434 = his exact MBID and P1953 = 2364880.
 */
function wikidataQid(url) {
  const match = /wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i.exec(url)
  return match ? match[1] : null
}

function verify() {
  if (!existsSync(OUT_DIR)) {
    console.log('No artist index built yet.')
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
  console.log(`shards: ${shards.length}`)
  console.log(`rows:   ${rows.toLocaleString()}`)
  console.log(`size:   ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  if (existsSync(META_PATH)) {
    const meta = JSON.parse(readFileSync(META_PATH, 'utf8'))
    console.log(`snapshot: ${meta.snapshot}`)
    console.log(`artists with discogs: ${meta.withDiscogs.toLocaleString()}`)
    console.log(`artists with youtube: ${meta.withYoutube.toLocaleString()}`)
  }
}

function readMember(name) {
  return new Promise((resolve) => {
    const child = spawn('tar', ['-xJOf', ARCHIVE, name])
    let buf = ''
    child.stdout.on('data', (chunk) => (buf += chunk))
    child.on('close', () => resolve(buf.trim() || 'unknown'))
    child.on('error', () => resolve('unknown'))
  })
}

async function build() {
  if (!existsSync(ARCHIVE)) throw new Error(`Missing ${ARCHIVE}`)
  const snapshot = await readMember('TIMESTAMP')
  console.log(
    `archive : ${ARCHIVE} (${(statSync(ARCHIVE).size / 1024 ** 3).toFixed(2)} GB)`,
  )
  console.log(`snapshot: ${snapshot}`)

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
  // Split on \n ONLY — readline also breaks on lone \r and shreds
  // records (see build-mb-dump-index.mjs; do not reintroduce it).
  child.stdout.setEncoding('utf8')

  let records = 0
  let written = 0
  let withDiscogs = 0
  let withYoutube = 0
  let withWikidata = 0
  let malformed = 0

  const handleLine = async (line) => {
    if (!line) return
    records += 1
    let artist
    try {
      artist = JSON.parse(line)
    } catch {
      malformed += 1
      return
    }
    const id = artist.id
    if (typeof id !== 'string' || id.length !== 36) return

    const discogs = []
    const youtube = []
    const wikidata = []
    for (const relation of artist.relations ?? []) {
      const url = relation?.url?.resource
      if (typeof url !== 'string') continue
      const dg = discogsArtistId(url)
      if (dg && !discogs.includes(dg)) discogs.push(dg)
      const qid = wikidataQid(url)
      if (qid && !wikidata.includes(qid)) wikidata.push(qid)
      if (/(?:^|\/\/)(?:www\.|m\.)?youtube\.com\//i.test(url)) youtube.push(url)
    }
    // Only artists carrying a link are worth a row — the index answers
    // "what is this artist's Discogs id", and silence is a real answer.
    if (discogs.length === 0 && youtube.length === 0 && wikidata.length === 0)
      return

    if (discogs.length > 0) withDiscogs += 1
    if (youtube.length > 0) withYoutube += 1
    if (wikidata.length > 0) withWikidata += 1

    const row = {
      a: id,
      n: artist.name ?? '',
      ...(discogs.length > 0 ? { dg: discogs } : {}),
      ...(youtube.length > 0 ? { yt: youtube } : {}),
      ...(wikidata.length > 0 ? { wd: wikidata } : {}),
    }
    const ok = writeRow(shardOf(id), JSON.stringify(row) + '\n')
    written += 1
    if (!ok) {
      await new Promise((resolve) =>
        streams.get(shardOf(id)).once('drain', resolve),
      )
    }
    if (records % PROGRESS_EVERY === 0) {
      console.log(
        `  ${records.toLocaleString()} artists · ${written.toLocaleString()} linked · ${withDiscogs.toLocaleString()} discogs`,
      )
    }
  }

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
    throw new Error(`tar exited ${exitCode} — index INCOMPLETE, not trusted.`)
  }

  writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        snapshot,
        builtAt: new Date().toISOString(),
        source: 'data.metabrainz.org json-dumps artist (CC0)',
        artists: records,
        linked: written,
        withDiscogs,
        withYoutube,
        withWikidata,
        malformed,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `\nDONE — ${records.toLocaleString()} artists → ${written.toLocaleString()} linked rows (${withDiscogs.toLocaleString()} discogs, ${withYoutube.toLocaleString()} youtube, ${withWikidata.toLocaleString()} wikidata)${malformed ? `, ${malformed} malformed` : ''}.`,
  )
  verify()
}

if (verifyOnly) verify()
else
  build().catch((error) => {
    console.error('artist index build failed:', error.message)
    process.exit(1)
  })
