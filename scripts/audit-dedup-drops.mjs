/**
 * Dedup-drop audit (owner-requested, REPORT-ONLY): for every gap-fill
 * candidate the v2 rebuild dropped on a name verdict (exact / alias /
 * fuzzy), re-derive WHAT it collided with in MusicBrainz and classify
 * the corroboration:
 *
 *   corroborated  — MB artist's area matches the swept country, or
 *                   its life-span overlaps the candidate's release
 *                   years (the same-artist story holds)
 *   contradicted  — MB artist's area is a DIFFERENT country (the
 *                   RDKPL pattern: bare name equality, facts disagree)
 *   uncorroborated — MB entry carries no area and no dates: nothing
 *                   but the name supports the drop
 *   irreproducible — MB search no longer returns the verdict's match
 *                   (the Amambay pattern: index-dependent deletion)
 *
 *   node scripts/audit-dedup-drops.mjs
 *
 * Resumable via data/dedup-drop-audit.json. Writes only that file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const WORK = join(ROOT, 'data', 'dedup-drop-audit.json')
const MB_UA = 'EarClefDedupAudit/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const COUNTRY_NAMES = { LA: 'Laos', PY: 'Paraguay' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

async function mbSearch(name) {
  const res = await fetch(
    `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&limit=5&fmt=json`,
    { headers: { 'User-Agent': MB_UA }, signal: AbortSignal.timeout(15000) },
  )
  if (!res.ok) throw new Error(`MB ${res.status}`)
  return res.json()
}

/** Same match logic as the pipeline's inMusicBrainz, but returns WHO. */
function findCollision(body, name) {
  const wanted = normalize(name)
  for (const artist of body.artists ?? []) {
    if (normalize(artist.name) === wanted) return { kind: 'exact', artist }
    for (const alias of artist.aliases ?? []) {
      if (normalize(alias.name ?? '') === wanted) {
        return { kind: 'alias', artist, aliasType: alias.type ?? '(untyped)' }
      }
    }
    if ((artist.score ?? 0) >= 90) {
      const theirs = normalize(artist.name)
      if (theirs.includes(wanted) || wanted.includes(theirs)) {
        return { kind: 'fuzzy', artist }
      }
    }
  }
  return null
}

function classify(collision, code, years) {
  const artist = collision.artist
  const area = artist.area?.name ?? null
  const begin = artist['begin-area']?.name ?? null
  const life = artist['life-span'] ?? {}
  const country = COUNTRY_NAMES[code]
  if (area === country || begin === country) return 'corroborated-area'
  const spanBegin = Number((life.begin ?? '').slice(0, 4)) || null
  const spanEnd = Number((life.end ?? '').slice(0, 4)) || (life.ended ? null : 2026)
  if (
    years.length > 0 &&
    spanBegin &&
    Math.min(...years) <= (spanEnd ?? 2026) &&
    Math.max(...years) >= spanBegin
  ) {
    return area ? 'contradicted-area-era-overlap' : 'era-overlap-only'
  }
  if (area) return 'contradicted'
  return 'uncorroborated'
}

const work = JSON.parse(
  readFileSync(join(ROOT, 'data', 'extra-artists-work-v2.json'), 'utf8'),
)
const audit = existsSync(WORK)
  ? JSON.parse(readFileSync(WORK, 'utf8'))
  : { drops: {} }

// Rebuild key -> {names, years} from structured credits + fallbacks.
const targets = []
for (const [code, state] of Object.entries(work.countries)) {
  const info = new Map()
  for (const [releaseId, credits] of Object.entries(state.credits ?? {})) {
    const release = (state.releases ?? []).find(
      (candidate) => String(candidate.id) === String(releaseId),
    )
    for (const credit of credits ?? []) {
      const key = `dg|${credit.id}`
      const entry = info.get(key) ?? { names: new Set(), years: new Set() }
      entry.names.add(credit.name)
      if (credit.anv) entry.names.add(credit.anv)
      if (release?.year) entry.years.add(release.year)
      info.set(key, entry)
    }
  }
  for (const [key, verdict] of Object.entries(state.checked ?? {})) {
    if (!['exact', 'alias', 'fuzzy'].includes(verdict)) continue
    const entry = info.get(key)
    const names = entry
      ? [...entry.names]
      : key.startsWith('nm|')
        ? [key.slice(3)]
        : [key]
    targets.push({
      code,
      key,
      verdict,
      names,
      years: entry ? [...entry.years] : [],
    })
  }
}
console.log(`${targets.length} dropped candidates to audit`)

for (const target of targets) {
  const auditKey = `${target.code}:${target.key}`
  if (audit.drops[auditKey]) continue
  let found = null
  for (const name of target.names.slice(0, 3)) {
    try {
      const body = await mbSearch(name)
      await sleep(1200)
      const collision = findCollision(body, name)
      if (collision) {
        found = {
          matchedName: name,
          collisionKind: collision.kind,
          aliasType: collision.aliasType,
          mbName: collision.artist.name,
          mbid: collision.artist.id,
          area: collision.artist.area?.name ?? null,
          beginArea: collision.artist['begin-area']?.name ?? null,
          disambiguation: collision.artist.disambiguation ?? null,
          classification: classify(collision, target.code, target.years),
        }
        break
      }
    } catch {
      await sleep(3000)
    }
  }
  audit.drops[auditKey] = {
    code: target.code,
    verdict: target.verdict,
    names: target.names,
    years: target.years,
    result: found ?? { classification: 'irreproducible' },
  }
  writeFileSync(WORK, JSON.stringify(audit, null, 1))
}

const values = Object.values(audit.drops)
console.log('=== DEDUP DROP AUDIT ===')
for (const verdict of ['exact', 'alias', 'fuzzy']) {
  const subset = values.filter((entry) => entry.verdict === verdict)
  console.log(`\n--- verdict "${verdict}": ${subset.length} drops ---`)
  const byClass = {}
  for (const entry of subset) {
    const cls = entry.result.classification
    byClass[cls] = (byClass[cls] ?? 0) + 1
  }
  console.log(JSON.stringify(byClass))
  for (const entry of subset) {
    const r = entry.result
    console.log(
      `  ${entry.code} "${entry.names[0]}" -> ${r.mbName ?? '?'} [${r.mbid ?? '-'}] area=${r.area ?? '?'} ${r.disambiguation ? `(${r.disambiguation}) ` : ''}=> ${r.classification}`,
    )
  }
}
