/**
 * LOCAL MUSICBRAINZ AREA INDEX — the parent chain for the dedup rule's
 * area walk (owner go, Sep 6, 2026).
 *
 * dedup-rule.mjs decides "does this artist's area sit inside the swept
 * country?" by walking `part of` relations upward, one API call per
 * hop at MusicBrainz's 1 req/s. The area JSON dump (33 MB, CC0) holds
 * the same relations, so the walk becomes a map lookup. The parent is
 * taken exactly as the API path takes it: the `part of` relation with
 * direction `backward`.
 *
 * Writes data/mb-dump/area-parents.json:
 *   { snapshot, builtAt, areas: { <id>: [name, type, parentId|null, isoCodes?] } }
 *
 * Usage: node scripts/build-mb-area-index.mjs
 */
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const DUMP_DIR = 'data/mb-dump'
const ARCHIVE = join(DUMP_DIR, 'area.tar.xz')
const MEMBER = 'mbdump/area'
const OUT_PATH = join(DUMP_DIR, 'area-parents.json')

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
    `archive : ${ARCHIVE} (${(statSync(ARCHIVE).size / 1024 ** 2).toFixed(1)} MB)`,
  )
  console.log(`snapshot: ${snapshot}`)

  const areas = {}
  let records = 0
  let malformed = 0
  let withParent = 0
  const child = spawn('tar', ['-xJOf', ARCHIVE, MEMBER])
  child.stdout.setEncoding('utf8')
  const handleLine = (line) => {
    if (!line) return
    records += 1
    let area
    try {
      area = JSON.parse(line)
    } catch {
      malformed += 1
      return
    }
    if (typeof area.id !== 'string' || area.id.length !== 36) return
    const parent = (area.relations ?? []).find(
      (relation) =>
        relation.type === 'part of' && relation.direction === 'backward',
    )
    const parentId = parent?.area?.id ?? null
    if (parentId) withParent += 1
    const iso = area['iso-3166-1-codes'] ?? []
    areas[area.id] = [
      area.name ?? '',
      area.type ?? null,
      parentId,
      ...(iso.length > 0 ? [iso] : []),
    ]
  }
  const exitCode = await new Promise((resolve, reject) => {
    let pending = ''
    // Split on \n ONLY (readline shreds on lone \r — see the other builders).
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
    throw new Error(`tar exited ${exitCode} — index INCOMPLETE, not trusted.`)
  }
  writeFileSync(
    OUT_PATH,
    JSON.stringify({
      snapshot,
      builtAt: new Date().toISOString(),
      source: 'data.metabrainz.org json-dumps area (CC0)',
      records,
      withParent,
      malformed,
      areas,
    }),
  )
  console.log(
    `DONE — ${records.toLocaleString()} areas (${withParent.toLocaleString()} with a parent${malformed ? `, ${malformed} malformed` : ''}) → ${OUT_PATH} (${(statSync(OUT_PATH).size / 1024 ** 2).toFixed(1)} MB)`,
  )
}

build().catch((error) => {
  console.error('area index build failed:', error.message)
  process.exit(1)
})
