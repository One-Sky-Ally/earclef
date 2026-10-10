/**
 * FEATURED LINKS THAT REST ON A NON-PERFORMING CREDIT (Oct 10, 2026).
 *
 * Owner ruling (e), Sep 4 2026: a "featured" anchor counts only for a
 * PERFORMING role. The role test in lib/extraPlayIdentity.mjs matched
 * substrings, so "Photography By" (rap), "Graphics" (rap) and "Arranged
 * By [Orchestra …]" (orchestra) passed it, and twelve serving links were
 * another act's recording whose sleeve the artist photographed or
 * designed. The test is fixed (owner, Oct 10: "fix … the performing-
 * credit check"); this moves the links it no longer supports.
 *
 * WHO: serving links whose anchors are ALL `featured` and whose artist
 * holds no performing role (the fixed isPerformingRole) on any record
 * the serving video sits on. Read from the evidence cache, no network.
 *
 * WHAT A MOVE IS (as the shared-credit re-check): the play URL stays;
 * `identityUnverified: true` + `identityHeld: 'non-performing-credit'`
 * stop it serving; the whole prior entry goes into
 * data/featured-role-held.json first. Idempotent.
 *
 *   node scripts/hold-non-performing-featured.mjs           # dry run
 *   node scripts/hold-non-performing-featured.mjs --write
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidencePath, isPerformingRole, PLAY_PATH, ROOT, videoIdOf } from './lib/extraPlayIdentity.mjs'

const HELD_PATH = join(ROOT, 'data', 'featured-role-held.json')
const WRITE = process.argv.includes('--write')
const RULING = 'Owner ruling (e), Sep 4 2026: featured credits count only for PERFORMING roles. Role test fixed Oct 10 2026 (it matched substrings: "Photography By" read as rap).'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** The artist's own roles on the records the serving video sits on. */
function rolesOnVideo(key, entry) {
  const path = evidencePath(key)
  if (!existsSync(path)) return null
  const evidence = readJson(path)
  const id = Number(evidence.discogsId)
  const videoId = videoIdOf(entry.play.url)
  const roles = []
  for (const record of evidence.records) {
    if (!record.videos.some((video) => video.videoId === videoId)) continue
    for (const credit of record.extraartists ?? []) if (credit.id === id) roles.push(credit.role)
    for (const track of record.tracklist) {
      for (const credit of track.extraartists ?? []) if (credit.id === id) roles.push(credit.role)
    }
  }
  return { name: evidence.name ?? null, countries: evidence.countries ?? [], roles }
}

function main() {
  const dataset = readJson(PLAY_PATH)
  const entries = dataset.entries
  const held = existsSync(HELD_PATH) ? readJson(HELD_PATH).cases : []
  const already = new Set(held.map((item) => item.key))
  const cases = []
  for (const [key, entry] of Object.entries(entries)) {
    const anchors = entry.identityEvidence?.anchors ?? []
    if (entry.identityUnverified || entry.play?.kind !== 'youtube-video') continue
    if (anchors.length === 0 || !anchors.every((anchor) => anchor === 'featured')) continue
    if (already.has(key)) continue
    const found = rolesOnVideo(key, entry)
    // No evidence file is not a verdict: such a link is left as it is.
    if (!found || found.roles.length === 0) continue
    if (found.roles.some((role) => isPerformingRole(role))) continue
    cases.push({ key, artist: found.name, countries: found.countries, title: entry.title ?? null, url: entry.play.url, roles: found.roles, entryBefore: entry })
  }
  console.log(`${cases.length} featured-only links rest on no performing role${WRITE ? '' : ' (dry run)'}`)
  for (const item of cases) console.log(`  ${item.key} ${item.artist} | ${item.title} | ${item.roles.join(' ; ')}`)
  if (!WRITE || cases.length === 0) return
  const next = { ...entries }
  for (const item of cases) {
    const kept = Object.fromEntries(Object.entries(item.entryBefore).filter(([field]) => field !== 'identityEvidence'))
    next[item.key] = { ...kept, identityUnverified: true, identityHeld: 'non-performing-credit' }
  }
  if (Object.keys(next).length !== Object.keys(entries).length) throw new Error('key count changed — nothing written')
  const today = new Date().toISOString().slice(0, 10)
  writeFileSync(HELD_PATH, `${JSON.stringify({ generatedAt: today, ruling: RULING, note: 'entryBefore is each entry exactly as it was; restoring one is putting it back.', total: held.length + cases.length, cases: [...held, ...cases] }, null, 1)}\n`)
  writeFileSync(PLAY_PATH, `${JSON.stringify({ ...dataset, generatedAt: today, entries: next }, null, 2)}\n`)
  console.log(`applied → ${HELD_PATH}`)
}

main()
