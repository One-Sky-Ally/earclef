/**
 * WHERE THE MUSIC WAS MADE, for "On this day" (owner, Oct 11 2026):
 * "show the city and country where that music was made. That's where it
 * was recorded, or where the artist was based and making music at the
 * time. Not where the artist was born, and not where the record was
 * merely released. … Only show what's verified."
 *
 * SOURCE: MusicBrainz's own "recorded at" (→ place → its area) and
 * "recorded in" (→ area) relationships, on each recording and on the
 * release as a whole, read from the local release dump
 * (data/mb-dump/release.tar.xz, streamed once with the system tar) and
 * resolved through the area hierarchy (data/mb-dump/area-parents.json).
 * Ids end to end; a release's country of issue is never read.
 *
 * NOT USED, on purpose: an artist's undated MusicBrainz area. "Based …
 * at the time" needs a DATED statement, and no local source has one (the
 * presence model's dated edges — Wikidata residence/work location with
 * start and end — are a later phase with their own go).
 *
 * Scope: every MusicBrainz release group listed on an "On this day" page
 * (lib/explore/on-this-day/*.json `rg`). Rules: scripts/lib/
 * onThisDayPlace.mjs. Output (kept apart from the day shards, so a day
 * rebuild never wipes it): lib/explore/on-this-day/places.json
 *   { builtAt, groups: { <rg id>: { release?: place, tracks?: { <songKey>: place } } } }
 * RESUMABLE (the laptop may sleep or close): every 250k releases the
 * groups found so far and the count scanned are checkpointed to
 * data/on-this-day-places-work.json. A rerun skips that many releases
 * without parsing them (the archive still decompresses — xz cannot seek
 * — but skipping is several times faster than parsing) and carries on.
 * The checkpoint is tied to the archive's size and the target count, and
 * removed once places.json is written.
 *
 *   node --max-old-space-size=12000 scripts/build-on-this-day-places.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { areaChain } from './lib/mbAreaIndex.mjs'
import { agreedPlace, placeOfChain, songKey } from './lib/onThisDayPlace.mjs'

const ARCHIVE = 'data/mb-dump/release.tar.xz'
const MEMBER = 'mbdump/release'
const SHARD_DIR = 'lib/explore/on-this-day'
const OUT_PATH = join(SHARD_DIR, 'places.json')
/** Resume point (gitignored): saved every PROGRESS_EVERY releases, removed when done. */
const CHECKPOINT_PATH = 'data/on-this-day-places-work.json'
const PROGRESS_EVERY = 250_000
const RECORDED = new Set(['recorded at', 'recorded in'])

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** The globe's own subdivision codes, by MusicBrainz area name, per country. */
function globeSubdivisions() {
  const states = readJson('lib/explore/us-states.json').states ?? []
  const nations = readJson('lib/explore/uk-nations.json').states ?? []
  return {
    US: Object.fromEntries(states.map((state) => [state.name, state.code])),
    GB: Object.fromEntries(nations.map((nation) => [nation.name, nation.code])),
  }
}

function targetGroups() {
  const groups = new Set()
  for (let month = 1; month <= 12; month++) {
    const shard = readJson(join(SHARD_DIR, `${String(month).padStart(2, '0')}.json`))
    for (const day of Object.values(shard.days)) for (const item of day.items) if (item.rg) groups.add(item.rg)
  }
  return groups
}

/** Area ids a list of relationships says the music was recorded in. */
function recordedAreas(relations) {
  const ids = []
  for (const relation of relations ?? []) {
    if (!RECORDED.has(relation.type)) continue
    const id = relation['target-type'] === 'place' ? relation.place?.area?.id : relation.area?.id
    if (id) ids.push(id)
  }
  return ids
}

/** The checkpoint identity: a different archive or target set starts over. */
const runIdentity = (targets) => `${statSync(ARCHIVE).size}:${targets.size}`

function loadCheckpoint(targets) {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    const saved = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'))
    if (saved.identity !== runIdentity(targets)) return null
    const found = new Map(
      Object.entries(saved.found).map(([rg, entry]) => [
        rg,
        { release: new Set(entry.release), tracks: new Map(Object.entries(entry.tracks).map(([key, ids]) => [key, new Set(ids)])) },
      ]),
    )
    return { scanned: saved.scanned, kept: saved.kept, found }
  } catch {
    return null
  }
}

function saveCheckpoint(targets, scanned, kept, found) {
  const serialised = Object.fromEntries(
    [...found].map(([rg, entry]) => [
      rg,
      { release: [...entry.release], tracks: Object.fromEntries([...entry.tracks].map(([key, ids]) => [key, [...ids]])) },
    ]),
  )
  // Write then rename: a sleep or kill mid-write never leaves a torn checkpoint.
  const temporary = `${CHECKPOINT_PATH}.tmp`
  writeFileSync(temporary, JSON.stringify({ identity: runIdentity(targets), scanned, kept, found: serialised }))
  renameSync(temporary, CHECKPOINT_PATH)
}

async function scan(targets) {
  const resumed = loadCheckpoint(targets)
  const resumeAt = resumed?.scanned ?? 0
  if (resumed) console.log(`resuming after ${resumeAt.toLocaleString()} releases (${resumed.found.size.toLocaleString()} groups found so far)`)
  /** rg → { release: Set<areaId>, tracks: Map<songKey, Set<areaId>> } */
  const found = resumed?.found ?? new Map()
  const child = spawn('tar', ['-xJOf', ARCHIVE, MEMBER])
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.warn(`  tar: ${text}`)
  })
  child.stdout.setEncoding('utf8')
  let pending = ''
  let scanned = 0
  let kept = resumed?.kept ?? 0
  for await (const chunk of child.stdout) {
    const lines = (pending + chunk).split('\n')
    pending = lines.pop()
    for (const line of lines) {
      if (!line) continue
      scanned++
      // Already covered by the checkpoint: count it, never parse it.
      if (scanned <= resumeAt) continue
      if (scanned % PROGRESS_EVERY === 0) {
        saveCheckpoint(targets, scanned, kept, found)
        console.log(`  ${scanned.toLocaleString()} releases scanned · ${kept.toLocaleString()} kept · ${found.size.toLocaleString()} groups with a place · checkpoint saved`)
      }
      let release
      try {
        release = JSON.parse(line)
      } catch {
        continue
      }
      const rg = release['release-group']?.id
      if (!rg || !targets.has(rg)) continue
      kept++
      const entry = found.get(rg) ?? { release: new Set(), tracks: new Map() }
      for (const id of recordedAreas(release.relations)) entry.release.add(id)
      for (const medium of release.media ?? []) {
        for (const track of medium.tracks ?? []) {
          const ids = recordedAreas(track.recording?.relations)
          if (ids.length === 0) continue
          for (const title of new Set([track.title, track.recording?.title].filter(Boolean))) {
            const key = songKey(title)
            if (!key) continue
            const set = entry.tracks.get(key) ?? new Set()
            for (const id of ids) set.add(id)
            entry.tracks.set(key, set)
          }
        }
      }
      if (entry.release.size > 0 || entry.tracks.size > 0) found.set(rg, entry)
    }
  }
  const exitCode = await new Promise((resolve) => child.on('close', resolve))
  if (exitCode !== 0) throw new Error(`tar exited ${exitCode} — places INCOMPLETE, not written`)
  console.log(`scan done: ${scanned.toLocaleString()} releases, ${kept.toLocaleString()} in scope, ${found.size.toLocaleString()} groups with a recording statement`)
  return found
}

async function main() {
  const targets = targetGroups()
  console.log(`release groups listed on "On this day": ${targets.size.toLocaleString()}`)
  const subdivisions = globeSubdivisions()
  const resolve = (ids) => agreedPlace([...ids].map((id) => placeOfChain(areaChain(id), subdivisions)))
  const found = await scan(targets)
  const groups = {}
  for (const [rg, entry] of found) {
    const release = resolve(entry.release)
    const tracks = Object.fromEntries(
      [...entry.tracks].map(([key, ids]) => [key, resolve(ids)]).filter(([, place]) => place),
    )
    if (!release && Object.keys(tracks).length === 0) continue
    groups[rg] = { ...(release ? { release } : {}), ...(Object.keys(tracks).length ? { tracks } : {}) }
  }
  writeFileSync(OUT_PATH, JSON.stringify({ builtAt: new Date().toISOString(), groups }))
  rmSync(CHECKPOINT_PATH, { force: true })
  console.log(`Done → ${OUT_PATH}: ${Object.keys(groups).length.toLocaleString()} release groups with a verified recording place`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
