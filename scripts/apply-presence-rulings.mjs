/**
 * Presence-model ruling applier (owner-approved model, Aug 25, 2026).
 *
 * THE PRINCIPLE (replaces the locked "only artists FROM a place"
 * line): presence means WHERE THE MUSIC HAPPENED — based, emerged,
 * performed/recorded — never birthplace alone (the Asunción test) and
 * never mere distribution. Edge kinds and their evidence bars live in
 * the handoff's PRESENCE MODEL entry.
 *
 * This script applies PRESENCE verdicts to gap-fill entries:
 *   archive — identity established, origin affirmatively unestablished;
 *             the entry stays in its pressing country's pool as an
 *             "archive" presence: rendered under the honest divider,
 *             excluded from the panel pool, list count, genre filter
 *             and rankings. Never deleted.
 *
 * Modes:
 *   --from-rerun-report   mark every held-rerun residue case whose
 *                         identity is id-confirmed or id-proven-other
 *                         (origin unknown by construction) as archive
 *   --case CC|dg|ID --presence archive|full   single owner ruling
 *                         (full = veto: restore full pool membership)
 *
 * Decisions are recorded in data/pattern-ruling-overrides.json
 * (lesson 2: the persistent decisions file) and annotated on the
 * sweep-work verdicts. Dataset entries gain/lose `presence: 'archive'`;
 * nothing is ever removed here.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATHS = {
  dataset: 'lib/explore/extra-artists.json',
  sweepWork: 'data/extra-artists-work-v2.json',
  overrides: 'data/pattern-ruling-overrides.json',
  report: 'data/held-ruling-rerun-report.json',
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

function applyPresence(targets) {
  const dataset = read(PATHS.dataset)
  const sweep = read(PATHS.sweepWork)
  const overrides = read(PATHS.overrides)
  const applied = []
  for (const t of targets) {
    const list = dataset.countries[t.cc] ?? []
    const entry = list.find((a) => String(a.discogsArtistId) === t.discogsId)
    if (!entry) {
      console.warn(`  ${t.cc} dg${t.discogsId}: not in dataset — skipped`)
      continue
    }
    dataset.countries[t.cc] = list.map((a) =>
      String(a.discogsArtistId) === t.discogsId
        ? t.presence === 'archive'
          ? { ...a, presence: 'archive' }
          : (({ presence: _drop, ...rest }) => rest)(a)
        : a,
    )
    const key = `dg|${t.discogsId}`
    if (sweep.countries[t.cc]?.verdicts?.[key]) {
      sweep.countries[t.cc].verdicts[key] = {
        ...sweep.countries[t.cc].verdicts[key],
        presence: t.presence,
        presenceBasis: t.basis,
      }
    }
    overrides[`${t.cc}|${key}`] = {
      proposal: t.presence === 'archive' ? 'archive-keep' : 'keep-policy-c',
      why: t.basis,
    }
    applied.push(`${t.cc} ${entry.name}`)
  }
  writeFileSync(PATHS.dataset, JSON.stringify(dataset, null, 2))
  writeFileSync(PATHS.sweepWork, JSON.stringify(sweep))
  writeFileSync(PATHS.overrides, JSON.stringify(overrides, null, 2))
  const archived = Object.values(dataset.countries)
    .flat()
    .filter((a) => a.presence === 'archive').length
  console.log(`applied ${applied.length} presence rulings · archive tier now ${archived} entries`)
  return applied
}

const mode = process.argv[2]
if (mode === '--from-rerun-report') {
  const report = read(PATHS.report)
  const targets = report.ownerResidue
    .filter((c) => c.identity === 'id-confirmed' || c.identity === 'id-proven-other')
    .map((c) => ({
      cc: c.pool,
      discogsId: String(c.discogsId),
      presence: 'archive',
      basis:
        `presence-model archive edge (Aug 25 2026, owner-approved model; vetoable per case): ` +
        `identity ${c.identity}, no origin signal — records verified pressed in pool country, origin unestablished`,
    }))
  console.log(`${targets.length} archive candidates from the re-run report`)
  applyPresence(targets)
} else if (mode === '--case') {
  const caseKey = process.argv[3]
  const presenceFlag = process.argv.indexOf('--presence')
  const presence = presenceFlag !== -1 ? process.argv[presenceFlag + 1] : null
  const m = /^([A-Z]{2})\|dg\|(\d+)$/.exec(caseKey ?? '')
  if (!m || !['archive', 'full'].includes(presence)) {
    console.error('Usage: --case CC|dg|ID --presence archive|full')
    process.exit(1)
  }
  applyPresence([
    {
      cc: m[1],
      discogsId: m[2],
      presence,
      basis: `owner ruling (presence model): ${presence} — applied ${new Date().toISOString().slice(0, 10)}`,
    },
  ])
} else {
  console.error('Usage: node scripts/apply-presence-rulings.mjs --from-rerun-report | --case CC|dg|ID --presence archive|full')
  process.exit(1)
}
