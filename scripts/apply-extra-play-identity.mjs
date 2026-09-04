/**
 * Gap-fill play repair — STEP 3, APPLY (its own owner go; default is a
 * dry run that writes nothing).
 *
 *   node scripts/apply-extra-play-identity.mjs            # dry run
 *   node scripts/apply-extra-play-identity.mjs --write    # commit verdicts
 *
 * Reads data/extra-play-identity-report.json (arbitrate-extra-play-
 * identity.mjs) and folds each artist verdict into the committed
 * lib/explore/extra-play.json:
 *
 *   verified  identityUnverified removed; identityEvidence recorded
 *   replaced  play.url → the verified candidate; the old link is KEPT
 *             as previousPlay (nothing is deleted); title/duration from
 *             the YouTube cache; queue flags reset (the replacement is
 *             public, embeddable and ≥90 s by construction)
 *   refuted   identityUnverified: true + identityRefuted reason — a
 *             kept-bucket link that fails the bar goes dark here
 *   held      identityUnverified: true + identityHeld reason
 *
 * Entries the report does not cover (id-less keys, never-swept keys,
 * archive and null verdicts) are untouched. The accessor
 * (lib/explore/extraPlay.ts) needs no change: it already reads
 * identityUnverified as the single serve/no-serve switch.
 *
 * Also writes data/extra-play-identity-held.json — the owner's held
 * list with the evidence each case carries (ruling-round material).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE_DIR, PLAY_PATH, ROOT, evidencePath } from './lib/extraPlayIdentity.mjs'

const REPORT_PATH = join(ROOT, 'data', 'extra-play-identity-report.json')
const HELD_PATH = join(ROOT, 'data', 'extra-play-identity-held.json')
const WRITE = process.argv.includes('--write')

const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
const dataset = JSON.parse(readFileSync(PLAY_PATH, 'utf8'))
const youtube = existsSync(join(EVIDENCE_DIR, 'youtube.json'))
  ? JSON.parse(readFileSync(join(EVIDENCE_DIR, 'youtube.json'), 'utf8'))
  : {}
const today = new Date().toISOString().slice(0, 10)

/** Strip every identity/queue flag so a verdict starts from the link itself. */
function bare(entry) {
  const { identityUnverified, identityEvidence, identityRefuted, identityHeld, previousPlay, queueEligible, gone, ...rest } = entry
  return rest
}

function evidenceOf(video) {
  return { anchors: video.anchors, legs: video.legs, verifiedAt: today }
}

function applyVerdict(entry, row) {
  const base = bare(entry)
  switch (row.verdict) {
    case 'verified':
      return { ...base, identityEvidence: evidenceOf(row.stored) }
    case 'replaced': {
      const meta = youtube[row.replacement.videoId] ?? {}
      return {
        ...base,
        play: { kind: 'youtube-video', url: `https://www.youtube.com/watch?v=${row.replacement.videoId}` },
        title: meta.title ?? row.replacement.title ?? base.title,
        durationSeconds: meta.durationSeconds ?? row.replacement.durationSeconds ?? base.durationSeconds,
        previousPlay: entry.previousPlay ?? entry.play,
        identityEvidence: evidenceOf(row.replacement),
      }
    }
    case 'refuted':
      return { ...base, identityUnverified: true, identityRefuted: row.stored.reason }
    default:
      return { ...base, identityUnverified: true, identityHeld: row.stored.reason }
  }
}

function heldCase(row) {
  const evidence = existsSync(evidencePath(row.key)) ? JSON.parse(readFileSync(evidencePath(row.key), 'utf8')) : null
  const records = (evidence?.records ?? [])
    .filter((r) => r.videos.some((v) => v.videoId === evidence.storedVideoId))
    .map((r) => ({ kind: r.kind, id: r.id, title: r.title, credits: r.artists.map((a) => a.name), tracks: r.tracklist.map((t) => t.title) }))
  return {
    key: row.key,
    artist: row.name,
    countries: row.countries,
    bucket: row.bucket,
    reason: row.stored.reason,
    url: `https://www.youtube.com/watch?v=${row.stored.videoId}`,
    uploadTitle: row.stored.title,
    onRecords: records,
    candidatesJudged: row.candidatesJudged,
  }
}

const entries = { ...dataset.entries }
const counts = { verified: 0, replaced: 0, refuted: 0, held: 0, missingEntry: 0 }
const wentDark = []
const held = []
for (const row of report.rows) {
  const entry = dataset.entries[row.key]
  if (!entry || entry.play?.kind !== 'youtube-video') {
    counts.missingEntry++
    continue
  }
  counts[row.verdict]++
  entries[row.key] = applyVerdict(entry, row)
  if (row.bucket === 'kept' && (row.verdict === 'refuted' || row.verdict === 'held')) wentDark.push(row.key)
  if (row.verdict === 'held') held.push(heldCase(row))
}

const serving = (map) => Object.values(map).filter((e) => e.play?.kind === 'youtube-video' && !e.identityUnverified).length
console.log(`verdicts applied: ${JSON.stringify(counts)}`)
console.log(`youtube links serving: ${serving(dataset.entries)} → ${serving(entries)} (kept-bucket links going dark: ${wentDark.length})`)
console.log(`held for the owner: ${held.length}`)
if (!WRITE) {
  console.log('\n(dry run — pass --write to commit; nothing written)')
  process.exit(0)
}
writeFileSync(PLAY_PATH, `${JSON.stringify({ ...dataset, generatedAt: today, entries }, null, 2)}\n`)
writeFileSync(HELD_PATH, `${JSON.stringify({ generatedAt: today, total: held.length, cases: held }, null, 1)}\n`)
console.log(`\nwritten: ${PLAY_PATH}\nwritten: ${HELD_PATH}`)
