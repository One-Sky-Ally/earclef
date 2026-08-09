/**
 * Drift ruling audit (owner-requested, REPORT-ONLY): for every release
 * that left the country search between the v1 and v2 sweeps, fetch it
 * directly by id and read its CURRENT country field. Rule on the
 * per-release data, not the query layer.
 *
 *   node scripts/audit-drift-departures.mjs
 *
 * Resumable via data/drift-audit-work.json; writes nothing else.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const WORK = join(ROOT, 'data', 'drift-audit-work.json')

function env(name) {
  if (process.env[name]) return process.env[name]
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && match[1] === name) return match[2].trim()
  }
  return null
}
const token = env('DISCOGS_TOKEN')
if (!token) throw new Error('DISCOGS_TOKEN required')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const EXPECTED = { LA: 'Laos', PY: 'Paraguay' }

const v1 = JSON.parse(readFileSync(join(ROOT, 'data', 'extra-artists-work.json'), 'utf8'))
const v2 = JSON.parse(readFileSync(join(ROOT, 'data', 'extra-artists-work-v2.json'), 'utf8'))
const work = existsSync(WORK)
  ? JSON.parse(readFileSync(WORK, 'utf8'))
  : { checked: {} }

const departed = []
for (const code of Object.keys(EXPECTED)) {
  const before = new Map(
    v1.countries[code].releases.map((release) => [release.id, release]),
  )
  const after = new Set(v2.countries[code].releases.map((release) => release.id))
  for (const [id, release] of before) {
    if (!after.has(id)) departed.push({ code, id, title: release.title })
  }
}
console.log(`${departed.length} departed releases to audit`)

for (const release of departed) {
  if (work.checked[release.id] !== undefined) continue
  try {
    const res = await fetch(
      `https://api.discogs.com/releases/${release.id}?token=${token}`,
      {
        headers: { 'User-Agent': 'EarClefDriftAudit/0.1' },
        signal: AbortSignal.timeout(15000),
      },
    )
    if (res.status === 404) {
      work.checked[release.id] = { code: release.code, verdict: 'deleted' }
    } else if (res.status === 429) {
      await sleep(5000)
      continue // retried on the next loop? no — record nothing, rerun picks it up
    } else if (!res.ok) {
      work.checked[release.id] = { code: release.code, verdict: `http-${res.status}` }
    } else {
      const body = await res.json()
      const country = body.country ?? '(none)'
      work.checked[release.id] = {
        code: release.code,
        verdict: country === EXPECTED[release.code] ? 'same' : 'changed',
        country,
        title: release.title.slice(0, 60),
      }
    }
  } catch {
    work.checked[release.id] = { code: release.code, verdict: 'error' }
  }
  writeFileSync(WORK, JSON.stringify(work))
  await sleep(1100)
}

const values = Object.values(work.checked)
const changed = values.filter((entry) => entry.verdict === 'changed')
console.log('=== DRIFT AUDIT ===')
console.log(`audited: ${values.length}/${departed.length}`)
console.log(`still correct country (index flakiness): ${values.filter((entry) => entry.verdict === 'same').length}`)
console.log(`deleted on Discogs: ${values.filter((entry) => entry.verdict === 'deleted').length}`)
console.log(`errors: ${values.filter((entry) => entry.verdict === 'error' || String(entry.verdict).startsWith('http')).length}`)
console.log(`COUNTRY CHANGED (corrections): ${changed.length}`)
for (const entry of changed) {
  console.log(`  ${entry.code} -> now "${entry.country}": ${entry.title}`)
}
