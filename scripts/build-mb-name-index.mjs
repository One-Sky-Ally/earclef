/**
 * LOCAL MUSICBRAINZ NAME INDEX — the candidate step of dedup rule v3,
 * off the API (owner go, Sep 6, 2026).
 *
 * The rule's candidate generation was a Lucene search
 * (`artist:"name"`, limit 5) followed by exactNameHit(), which keeps
 * only an artist whose NAME or a properly TYPED alias (Artist name /
 * Legal name) normalizes to the probe. The search was only recall; the
 * decision was always the exact comparison. This index stores that
 * exact comparison directly: every artist under normalizeName(name)
 * and under each typed alias, so `artistsNamed(probe)` returns the
 * same set exactNameHit would have accepted — with better recall than
 * a five-result search, and no 1 req/s throttle.
 *
 * Records keep the web-service shape the rule reads (id, name, type,
 * country, area, begin-area, life-span, aliases[{name,type}],
 * disambiguation) so judgeNameHit() is untouched.
 *
 * Untyped aliases are NOT keys (rule v3 point 4) — an untyped-alias
 * hit could never pass exactNameHit, so indexing it would only add
 * lookups that decide nothing. Empty keys are never written: absent
 * must never match (standing lesson 5).
 *
 * Writes data/mb-dump/artist-names/<xx>.jsonl (256 shards by key hash):
 *   {"k": <normalized key>, "r": <record>}
 *
 * Usage:
 *   node scripts/build-mb-name-index.mjs
 *   node scripts/build-mb-name-index.mjs --verify
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
import { normalizeName } from './lib/dedup-rule.mjs'
import { nameShardOf, ALLOWED_ALIAS_TYPES } from './lib/mbNameIndex.mjs'

const DUMP_DIR = 'data/mb-dump'
const ARCHIVE = join(DUMP_DIR, 'artist.tar.xz')
const MEMBER = 'mbdump/artist'
const OUT_DIR = join(DUMP_DIR, 'artist-names')
const META_PATH = join(DUMP_DIR, 'artist-names-meta.json')
const PROGRESS_EVERY = 250_000

const verifyOnly = process.argv.includes('--verify')

function verify() {
  if (!existsSync(OUT_DIR)) {
    console.log('No name index built yet.')
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
    console.log(`artists:  ${meta.artists.toLocaleString()} · name keys ${meta.nameKeys.toLocaleString()} · typed-alias keys ${meta.aliasKeys.toLocaleString()}`)
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

const areaRef = (area) =>
  area && typeof area.id === 'string'
    ? { id: area.id, name: area.name ?? null, type: area.type ?? null }
    : null

/** The record judgeNameHit() reads — web-service key names, nothing extra. */
function compactRecord(artist) {
  const life = artist['life-span'] ?? {}
  return {
    id: artist.id,
    name: artist.name ?? '',
    type: artist.type ?? null,
    country: artist.country ?? null,
    area: areaRef(artist.area),
    'begin-area': areaRef(artist['begin-area']),
    'life-span': {
      begin: life.begin ?? null,
      end: life.end ?? null,
      ended: life.ended === true,
    },
    aliases: (artist.aliases ?? [])
      .filter((alias) => typeof alias?.name === 'string' && alias.name)
      .map((alias) => ({ name: alias.name, type: alias.type ?? null })),
    ...(artist.disambiguation ? { disambiguation: artist.disambiguation } : {}),
  }
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
  child.stdout.setEncoding('utf8')

  let records = 0
  let nameKeys = 0
  let aliasKeys = 0
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
    if (typeof artist.id !== 'string' || artist.id.length !== 36) return
    const record = compactRecord(artist)
    const keys = new Set()
    const nameKey = normalizeName(record.name)
    if (nameKey) {
      keys.add(nameKey)
      nameKeys += 1
    }
    for (const alias of record.aliases) {
      if (!ALLOWED_ALIAS_TYPES.has(alias.type ?? '')) continue
      const key = normalizeName(alias.name)
      if (!key || keys.has(key)) continue
      keys.add(key)
      aliasKeys += 1
    }
    const serialized = JSON.stringify(record)
    for (const key of keys) {
      const shard = nameShardOf(key)
      const ok = writeRow(shard, `{"k":${JSON.stringify(key)},"r":${serialized}}\n`)
      if (!ok) {
        await new Promise((resolve) =>
          streams.get(shard).once('drain', resolve),
        )
      }
    }
    if (records % PROGRESS_EVERY === 0) {
      console.log(
        `  ${records.toLocaleString()} artists · ${nameKeys.toLocaleString()} name keys · ${aliasKeys.toLocaleString()} typed-alias keys`,
      )
    }
  }

  const exitCode = await new Promise((resolve, reject) => {
    let pending = ''
    let chain = Promise.resolve()
    // Split on \n ONLY — readline breaks on lone \r and shreds records.
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
        nameKeys,
        aliasKeys,
        malformed,
        complete: true,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `\nDONE — ${records.toLocaleString()} artists → ${(nameKeys + aliasKeys).toLocaleString()} key rows${malformed ? `, ${malformed} malformed` : ''}.`,
  )
  verify()
}

if (verifyOnly) verify()
else
  build().catch((error) => {
    console.error('name index build failed:', error.message)
    process.exit(1)
  })
