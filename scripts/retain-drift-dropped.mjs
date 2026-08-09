/**
 * Retention pass after a structured-credits rebuild: Discogs's
 * country-search index FLUCTUATES (releases present on Aug 7 were
 * absent on Aug 9), and an artist must not vanish from the site
 * because the source index blinked.
 *
 *   node scripts/retain-drift-dropped.mjs <before-dataset.json>
 *
 * Re-adds previously committed entries that are ABSENT from the
 * rebuilt dataset ONLY when:
 *   · the name is not a credit-string artifact ('/' joints — those
 *     are exactly what the rebuild supersedes), and
 *   · no v2 candidate with that normalized name (canonical or ANV)
 *     was judged known to MusicBrainz — MB-canonical removals stand.
 * Retained entries carry retainedFrom (the snapshot date) so the
 * owner can review or drop them wholesale: strict-mirror vs retain
 * is an owner policy call, and this errs on keeping what an earlier
 * approved sweep already vetted.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const beforePath = process.argv[2]
if (!beforePath) {
  throw new Error('usage: node scripts/retain-drift-dropped.mjs <before-dataset.json>')
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const datasetPath = join(ROOT, 'lib', 'explore', 'extra-artists.json')
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))
const work = JSON.parse(
  readFileSync(join(ROOT, 'data', 'extra-artists-work-v2.json'), 'utf8'),
)
const legacyWork = JSON.parse(
  readFileSync(join(ROOT, 'data', 'extra-artists-work.json'), 'utf8'),
)

/** v1's normalize — needed to look old names up in v1's candidates. */
function legacyNormalize(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9຀-໿]+/g, ' ')
    .trim()
}

/**
 * The release that documented an old entry, per v1's candidate map.
 * If that release IS in v2's search results, the entry was not lost
 * to index drift — the rebuild read its structured credits and the
 * old display-string name is a superseded artifact. Only entries
 * whose supporting release truly left the index are drift victims.
 */
const v2ReleaseIds = new Map(
  Object.entries(work.countries ?? {}).map(([code, state]) => [
    code,
    new Set((state.releases ?? []).map((release) => release.id)),
  ]),
)
function supersededByCredits(country, oldName) {
  const releasesInV2 = v2ReleaseIds.get(country)
  if (!releasesInV2) return false
  const legacyState = legacyWork.countries?.[country]
  if (!legacyState?.releases) return false
  const key = legacyNormalize(oldName)
  for (const release of legacyState.releases) {
    const parsed = release.title.split(/\s+[–—-]\s+/)[0]?.trim() ?? ''
    if (
      legacyNormalize(parsed.replace(/\s*\(\d+\)\s*$/, '').replace(/\*+$/, '')) ===
        key &&
      releasesInV2.has(release.id)
    ) {
      return true
    }
  }
  return false
}

// Normalized name (canonical or ANV) -> worst MB verdict seen in v2.
const verdictByName = new Map()
for (const state of Object.values(work.countries ?? {})) {
  const names = new Map()
  for (const credits of Object.values(state.credits ?? {})) {
    for (const credit of credits ?? []) {
      const key = `dg|${credit.id}`
      const list = names.get(key) ?? new Set()
      list.add(credit.name)
      if (credit.anv) list.add(credit.anv)
      names.set(key, list)
    }
  }
  for (const [key, verdict] of Object.entries(state.checked ?? {})) {
    const spellings = names.get(key) ?? new Set()
    if (key.startsWith('nm|')) spellings.add(key.slice(3))
    for (const spelling of spellings) {
      const norm = normalizeName(spelling)
      if (!norm) continue
      const existing = verdictByName.get(norm)
      // A known-to-MB verdict outranks 'new' for the retention gate.
      if (!existing || existing === 'new') verdictByName.set(norm, verdict)
    }
  }
}

const report = []
for (const [country, oldList] of Object.entries(before.countries)) {
  const current = dataset.countries[country] ?? []
  const currentIds = new Set(
    current.map((a) => a.discogsArtistId).filter((id) => id != null),
  )
  const currentNames = new Set(
    current.flatMap((a) =>
      [a.name, ...(a.aliases ?? [])].map(normalizeName),
    ),
  )
  for (const old of oldList) {
    if (old.name.includes('/')) continue // credit-string artifact
    const present =
      (old.discogsArtistId != null && currentIds.has(old.discogsArtistId)) ||
      currentNames.has(normalizeName(old.name))
    if (present) continue
    const verdict = verdictByName.get(normalizeName(old.name))
    if (verdict && verdict !== 'new') {
      report.push(`${country}: ${old.name} — DROPPED stands (MB verdict: ${verdict})`)
      continue
    }
    if (supersededByCredits(country, old.name)) {
      report.push(`${country}: ${old.name} — DROPPED stands (release re-read; structured credits supersede the display-string name)`)
      continue
    }
    dataset.countries[country] = [
      ...(dataset.countries[country] ?? []),
      { ...old, retainedFrom: before.generatedAt ?? 'pre-v2' },
    ]
    report.push(`${country}: ${old.name} — RETAINED (index drift, no MB verdict)`)
  }
}

writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`)
console.log(report.join('\n'))
const retained = report.filter((line) => line.includes('RETAINED')).length
console.log(`\n${retained} retained, ${report.length - retained} drops upheld -> ${datasetPath}`)
