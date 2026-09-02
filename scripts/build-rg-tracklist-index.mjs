/**
 * PER-SONG FOUNDATION, PART 2 (owner-approved Aug 31, 2026: "Yes,
 * per-song is the direction"): the tracklists of every CANDIDATE
 * release group, extracted from MusicBrainz's release dump.
 *
 * THE RULE THIS SERVES: music belongs to when it was CREATED. A
 * spanning compilation has no single true year — its songs do. The
 * Discogs sweep persists each artist's title→earliest-year map
 * (`titleYears`); this index supplies the OTHER half of the join: which
 * song titles are actually ON each candidate release group. Stage 3
 * joins the two locally — track title → earliest dated pressing — and
 * that is per-song dating, plus the owner's retrospective test (every
 * dated track older than the release year ⇒ the album belongs to the
 * era it represents, as a SPAN).
 *
 * Reads release.tar.xz (20.9 GB, ~4.9M releases) ONCE, keeps only
 * releases whose release-group id is among the 237k candidates, and
 * writes one row per candidate RG: its deduped track titles. Track
 * titles are stored RAW (not normalised) so Stage 3 can show the owner
 * real titles; normalisation happens at join time with the same
 * titleKey the evidence sweep uses.
 *
 * Recording MBIDs are deliberately NOT stored: the per-song join runs
 * on titles against Discogs (a different ID space — recording ids
 * cannot cross it), and ~130 MB of ids with no consumer is exactly the
 * kind of just-in-case payload this project keeps declining to carry.
 * The dump stays on disk; a future recording-level pass re-streams it.
 *
 * Accumulates in memory (~237k RGs), writes at the end — a partial
 * output file cannot exist, so a killed run is simply re-run.
 *
 * Usage:
 *   node scripts/build-rg-tracklist-index.mjs            # build
 *   node scripts/build-rg-tracklist-index.mjs --verify   # stats only
 */
import {
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

const SWEEP_DIR = 'data/rg-dating-sweep'
const ARCHIVE = 'data/mb-dump/release.tar.xz'
const MEMBER = 'mbdump/release'
const OUT_DIR = 'data/mb-dump/rg-tracklists'
const META_PATH = 'data/mb-dump/rg-tracklists-meta.json'
const PROGRESS_EVERY = 250_000
/** Titles kept per release group — no real tracklist exceeds this. */
const MAX_TRACKS_PER_RG = 200

const verifyOnly = process.argv.includes('--verify')

/** Same normalisation as the evidence sweep — dedupe key only. */
const titleKey = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

function loadCandidateIds() {
  const ids = new Set()
  for (const file of readdirSync(SWEEP_DIR).filter((f) => f.endsWith('.json'))) {
    const shard = JSON.parse(readFileSync(join(SWEEP_DIR, file), 'utf8'))
    for (const artist of shard.artists) {
      for (const candidate of artist.candidates) ids.add(candidate.id)
    }
  }
  return ids
}

function verify() {
  if (!existsSync(META_PATH)) {
    console.log('No tracklist index built yet.')
    return
  }
  const meta = JSON.parse(readFileSync(META_PATH, 'utf8'))
  console.log(JSON.stringify(meta, null, 2))
}

async function build() {
  if (!existsSync(ARCHIVE)) throw new Error(`Missing ${ARCHIVE}`)
  const candidates = loadCandidateIds()
  console.log(
    `archive : ${ARCHIVE} (${(statSync(ARCHIVE).size / 1024 ** 3).toFixed(1)} GB)`,
  )
  console.log(`candidate release groups: ${candidates.size.toLocaleString()}`)

  /** rgId → { t: raw titles[], keys: Set of dedupe keys, r: release count } */
  const byRg = new Map()

  const child = spawn('tar', ['-xJOf', ARCHIVE, MEMBER])
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.warn(`  tar: ${text}`)
  })
  // Split on \n ONLY — readline breaks on lone \r and shreds records
  // (proven on the release-group dump; do not reintroduce it).
  child.stdout.setEncoding('utf8')

  let records = 0
  let kept = 0
  let malformed = 0

  const handleLine = (line) => {
    if (!line) return
    records += 1
    if (records % PROGRESS_EVERY === 0) {
      console.log(
        `  ${records.toLocaleString()} releases scanned · ${kept.toLocaleString()} kept · ${byRg.size.toLocaleString()} RGs covered`,
      )
    }
    // Cheap pre-filter: candidate RG ids are 36-char uuids; skip the
    // full JSON.parse (the expensive step, 4.9M times) unless the line
    // even mentions a candidate id. indexOf on the raw line with the
    // rg id is not possible without knowing which — so parse only when
    // the "release-group" key exists at all (it always does) — no
    // cheap out here; parse every line.
    let release
    try {
      release = JSON.parse(line)
    } catch {
      malformed += 1
      return
    }
    const rgId = release['release-group']?.id
    if (!rgId || !candidates.has(rgId)) return
    kept += 1
    let entry = byRg.get(rgId)
    if (!entry) {
      entry = { t: [], keys: new Set(), r: 0 }
      byRg.set(rgId, entry)
    }
    entry.r += 1
    for (const medium of release.media ?? []) {
      for (const track of medium.tracks ?? []) {
        const title = track.title ?? track.recording?.title ?? ''
        const key = titleKey(title)
        if (!key || entry.keys.has(key)) continue
        if (entry.t.length >= MAX_TRACKS_PER_RG) break
        entry.keys.add(key)
        entry.t.push(title)
      }
    }
  }

  const exitCode = await new Promise((resolve, reject) => {
    let pending = ''
    child.stdout.on('data', (chunk) => {
      const parts = (pending + chunk).split('\n')
      pending = parts.pop() ?? ''
      for (const line of parts) handleLine(line)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (pending) handleLine(pending)
      resolve(code)
    })
  })
  if (exitCode !== 0) {
    throw new Error(`tar exited ${exitCode} — index INCOMPLETE, not written.`)
  }

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })
  const shards = new Map()
  for (const [rgId, entry] of byRg) {
    const shard = rgId.slice(0, 2)
    const rows = shards.get(shard) ?? []
    rows.push(JSON.stringify({ g: rgId, r: entry.r, t: entry.t }))
    shards.set(shard, rows)
  }
  for (const [shard, rows] of shards) {
    writeFileSync(join(OUT_DIR, `${shard}.jsonl`), rows.join('\n') + '\n')
  }

  const meta = {
    builtAt: new Date().toISOString(),
    source: 'data.metabrainz.org json-dumps release (CC0)',
    releasesScanned: records,
    releasesKept: kept,
    candidateRgs: candidates.size,
    rgsCovered: byRg.size,
    rgsWithoutAnyRelease: candidates.size - byRg.size,
    malformed,
  }
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n')
  console.log(
    `\nDONE — ${records.toLocaleString()} releases scanned, ${kept.toLocaleString()} kept, ${byRg.size.toLocaleString()} of ${candidates.size.toLocaleString()} candidate RGs covered.`,
  )
}

if (verifyOnly) verify()
else
  build().catch((error) => {
    console.error('tracklist index build failed:', error.message)
    process.exit(1)
  })
