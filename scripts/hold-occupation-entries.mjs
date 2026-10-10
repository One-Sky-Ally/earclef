/**
 * OCCUPATION HOLD — entries the owner wants to HEAR before they stay
 * (owner, Oct 10 2026: "Hold the three Uzbek ashiks until I've listened
 * to them."). They came in with the occupation-filter run (cd878c8) on
 * Wikidata class Q7097633 ashik alone; the three are a near-sequential
 * QID batch, and "qori" in Yunusqori is the Uzbek reciter honorific.
 *
 * WHAT A MOVE IS. The entry leaves lib/explore/extra-artists.json and is
 * stored WHOLE in data/occupation-held.json. scripts/lib/originHeld.mjs
 * reads that file (keyed by pool + Wikidata id, as these entries have no
 * Discogs id), so a sweep cannot re-append a held entry. Nothing is
 * deleted. Idempotent: a case already held is not moved again.
 *
 * PUTTING ONE BACK. `--release UZ|Q126327433 --because "<what the owner
 * heard>" --write` returns the stored record to its pool unchanged and
 * records the release.
 *
 *   node scripts/hold-occupation-entries.mjs            # dry run
 *   node scripts/hold-occupation-entries.mjs --write
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { byDatedThenPressed } from './lib/gapFillMerge.mjs'

const POOL_PATH = 'lib/explore/extra-artists.json'
const HELD_PATH = 'data/occupation-held.json'
const RULED_ON = '2026-10-10'
const RULING = 'Owner, Oct 10 2026: "Hold the three Uzbek ashiks until I\'ve listened to them."'

/** The ruled cases — named, never derived (the ruling names these three). */
const TO_HOLD = [
  { country: 'UZ', wikidataId: 'Q126327433', name: 'Gʻulomjon Roʻziboyev' },
  { country: 'UZ', wikidataId: 'Q126331866', name: 'Yunusqori Yusupov' },
  { country: 'UZ', wikidataId: 'Q126332003', name: 'Nazirjon Akbarov' },
]
const REASON = 'Wikidata occupation Q7097633 (ashik) only; near-sequential QID batch; held for the owner to listen'

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
const argOf = (flag) => {
  const at = argv.indexOf(flag)
  return at === -1 ? null : argv[at + 1]
}
const RELEASE = argOf('--release')
const BECAUSE = argOf('--because')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const caseKey = (item) => `${item.country}|${item.wikidataId}`
const total = (countries) => Object.values(countries).reduce((sum, list) => sum + list.length, 0)

function loadHeld() {
  return existsSync(HELD_PATH)
    ? readJson(HELD_PATH)
    : { generatedAt: null, ruledOn: RULED_ON, ruling: RULING, cases: [], released: [] }
}

function hold(pool, held) {
  const onRecord = new Set(held.cases.map(caseKey))
  const released = new Set((held.released ?? []).map((item) => item.caseKey))
  const moved = []
  const countries = { ...pool.countries }
  for (const target of TO_HOLD) {
    const key = caseKey(target)
    if (onRecord.has(key) || released.has(key)) continue
    const list = countries[target.country] ?? []
    const matches = list.filter((entry) => entry.wikidataId === target.wikidataId)
    if (matches.length !== 1) throw new Error(`${key}: ${matches.length} pool entries carry this Wikidata id — nothing written`)
    if (matches[0].name !== target.name) throw new Error(`${key}: pool name "${matches[0].name}" is not "${target.name}" — nothing written`)
    countries[target.country] = list.filter((entry) => entry !== matches[0])
    moved.push({ caseKey: key, country: target.country, wikidataId: target.wikidataId, reason: REASON, record: matches[0] })
  }
  const before = total(pool.countries)
  const after = total(countries)
  if (before - after !== moved.length) throw new Error(`pool shrank by ${before - after} but ${moved.length} were moved — nothing written`)
  return { countries, moved }
}

function release(pool, held) {
  if (!BECAUSE) throw new Error('--release needs --because "<what the owner heard>"')
  const item = held.cases.find((entry) => entry.caseKey === RELEASE)
  if (!item) throw new Error(`${RELEASE} is not on the held list`)
  const list = pool.countries[item.country] ?? []
  if (list.some((entry) => entry.wikidataId === item.wikidataId)) throw new Error(`${RELEASE} is already in the ${item.country} pool`)
  const countries = { ...pool.countries, [item.country]: [...list, item.record].sort(byDatedThenPressed) }
  const cases = held.cases.filter((entry) => entry !== item)
  const released = [...(held.released ?? []), { caseKey: item.caseKey, releasedOn: new Date().toISOString().slice(0, 10), because: BECAUSE, record: item.record }]
  return { countries, cases, released }
}

function main() {
  const pool = readJson(POOL_PATH)
  const held = loadHeld()
  const today = new Date().toISOString().slice(0, 10)
  if (RELEASE) {
    const { countries, cases, released } = release(pool, held)
    console.log(`release ${RELEASE}${WRITE ? '' : ' (dry run)'}`)
    if (!WRITE) return
    writeFileSync(POOL_PATH, `${JSON.stringify({ ...pool, countries }, null, 2)}\n`)
    writeFileSync(HELD_PATH, `${JSON.stringify({ ...held, generatedAt: today, cases, released }, null, 2)}\n`)
    return
  }
  const { countries, moved } = hold(pool, held)
  console.log(`${moved.length} to move${WRITE ? '' : ' (dry run)'}: ${moved.map((item) => `${item.caseKey} ${item.record.name}`).join('; ') || 'none'}`)
  if (!WRITE || moved.length === 0) return
  // The held file FIRST: if the pool write then fails, nothing is lost.
  writeFileSync(HELD_PATH, `${JSON.stringify({ ...held, generatedAt: today, cases: [...held.cases, ...moved] }, null, 2)}\n`)
  writeFileSync(POOL_PATH, `${JSON.stringify({ ...pool, countries }, null, 2)}\n`)
}

main()
