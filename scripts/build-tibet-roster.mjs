/**
 * Tibet roster build (pilot session 2, owner go Aug 28, 2026).
 *
 * Assembles lib/explore/claimed-places/tibet.json from the committed
 * evidence report + the persistent rulings file. Inclusion logic:
 *   in  — verdict include-proposed AND no overriding ruling, or an
 *         explicit owner/test include ruling
 *   out — teachings-class exclusion, monastery-test exclusion,
 *         empty-catalog hold, owner hold, or held-thin
 * Every row keeps its evidence keys and filing label; the roster is
 * regenerable and the rulings file is the single decision record.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const report = JSON.parse(readFileSync('data/tibet-evidence-report.json', 'utf8'))
const rulings = JSON.parse(readFileSync('data/tibet-roster-rulings.json', 'utf8'))

const rulingFor = (row) =>
  rulings.cases[row.mbid] ??
  Object.values(rulings.cases).find((c) => c.name === row.name) ??
  null

const roster = []
const excluded = []
for (const row of report.rows) {
  const ruling = rulingFor(row)
  const verdict = ruling?.ruling ?? null
  const isIn =
    (row.verdict === 'include-proposed' && (verdict === null || verdict.startsWith('include'))) ||
    (verdict !== null && verdict.startsWith('include'))
  if (!isIn) {
    if (row.verdict === 'include-proposed' || verdict) {
      excluded.push(`${row.name} (${verdict ?? row.verdict})`)
    }
    continue
  }
  roster.push({
    mbid: row.mbid,
    name: row.name,
    type: row.type,
    lifeBegin: row.life?.begin ? Number(String(row.life.begin).slice(0, 4)) : null,
    lifeEnd: row.life?.end ? Number(String(row.life.end).slice(0, 4)) : null,
    tags: row.tags,
    filing: row.wing,
    evidence: row.evidenceKeys.join('+') + (ruling ? ` · ${ruling.ruling}` : ''),
  })
}
roster.sort((a, b) => a.name.localeCompare(b.name))

mkdirSync('lib/explore/claimed-places', { recursive: true })
writeFileSync(
  'lib/explore/claimed-places/tibet.json',
  JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), placeId: 'tibet', artists: roster }, null, 1),
)
const filing = {}
for (const artist of roster) filing[artist.filing] = (filing[artist.filing] ?? 0) + 1
console.log(`roster: ${roster.length} artists · filing ${JSON.stringify(filing)}`)
console.log('in:', roster.map((a) => a.name).join(' · '))
console.log('held out:', excluded.join(' · '))
