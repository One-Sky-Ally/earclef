/**
 * The gap-fill sweep's Wikidata pass, kept apart from the sweep script
 * so it can be tested without network or a Discogs token.
 *
 * Occupation admission comes from musicOccupations.mjs (the one
 * definition). The query asks for items carrying a LISTED performer or
 * owner-ruled class by exact VALUES match; there is no subclass walk.
 */
import {
  OWNER_RULED_P106,
  PERFORMER_P106,
  PERFORMER_P31,
  SPOKEN_WORD,
  classifyOccupations,
  ownerRuledClassesOf,
  sparqlValues,
} from './musicOccupations.mjs'

/**
 * Musicians and groups tied to a country, with dates, the ID
 * crosswalk and the listed occupations that matched. P27 is
 * CITIZENSHIP, which is not musical origin (the Tina Turner problem),
 * so birthplace and formation country come alongside it.
 */
export function wikidataQuery(qid, labelLangs) {
  const p106 = sparqlValues(new Set([...PERFORMER_P106, ...OWNER_RULED_P106]))
  const p31 = sparqlValues(PERFORMER_P31)
  return `SELECT ?item ?itemLabel ?mbid ?discogs ?birth ?formed ?bornIn ?formedIn ?citizen ?occ ?occLabel ?grp ?grpLabel WHERE {
  { ?item wdt:P27 wd:${qid} } UNION { ?item wdt:P495 wd:${qid} }
  { VALUES ?occ { ${p106} } ?item wdt:P106 ?occ }
  UNION { VALUES ?grp { ${p31} } ?item wdt:P31 ?grp }
  OPTIONAL { ?item wdt:P434 ?mbid }
  OPTIONAL { ?item wdt:P1953 ?discogs }
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item wdt:P571 ?formed }
  OPTIONAL { ?item wdt:P19 ?bp . ?bp wdt:P17 ?bornIn }
  OPTIONAL { ?item wdt:P740 ?fp . ?fp wdt:P17 ?formedIn }
  OPTIONAL { ?item wdt:P27 ?citizen }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${labelLangs}". }
}`
}

const qidOf = (row, key) => row[key]?.value.split('/').pop() ?? null

/**
 * SPARQL bindings → one record per item. Multi-valued properties arrive
 * as extra rows and are unioned. Unlabelled items (label is their own
 * QID) are skipped — useless as a name. Items whose occupations are not
 * listed cannot come back from the query, but are dropped here too, so
 * admission never rests on the query alone.
 */
export function collectWikidataRows(bindings) {
  const byItem = new Map()
  for (const row of bindings) {
    const id = row.item.value.split('/').pop()
    const label = row.itemLabel?.value ?? ''
    if (!label || /^Q\d+$/.test(label)) continue
    let entry = byItem.get(id)
    if (!entry) {
      const birth = row.birth?.value ? Number(row.birth.value.slice(0, 4)) : null
      const formed = row.formed?.value ? Number(row.formed.value.slice(0, 4)) : null
      entry = {
        wikidataId: id,
        name: label,
        mbid: row.mbid?.value ?? null,
        discogsId: row.discogs?.value ?? null,
        // Career-start proxy, matching the MB convention used site-wide.
        year: formed ?? (birth ? birth + 15 : null),
        bornIn: qidOf(row, 'bornIn'),
        formedIn: qidOf(row, 'formedIn'),
        citizenships: new Set(),
        occupations: new Set(),
        // 'P106:Qn' → label, for the run report (reviewing what admitted whom).
        occupationLabels: {},
      }
      byItem.set(id, entry)
    }
    const citizen = qidOf(row, 'citizen')
    if (citizen) entry.citizenships.add(citizen)
    entry.bornIn ??= qidOf(row, 'bornIn')
    entry.formedIn ??= qidOf(row, 'formedIn')
    for (const [key, via] of [['occ', 'P106'], ['grp', 'P31']]) {
      const cls = qidOf(row, key)
      if (!cls) continue
      entry.occupations.add(`${via}:${cls}`)
      const clsLabel = row[`${key}Label`]?.value
      if (clsLabel && clsLabel !== cls) entry.occupationLabels[`${via}:${cls}`] = clsLabel
    }
  }
  return [...byItem.values()]
    .map((entry) => ({ ...entry, admission: classifyOccupations([...entry.occupations]) }))
    .filter((entry) => entry.admission !== null)
}

/**
 * OWNER RULING (Sep 21, 2026, verbatim in data/occupation-filter-lists
 * .json `ownerRuling`): conductors, choir directors, record-producer
 * -only, spoken word, arrangers, beatmakers "can be added if they made
 * and released original audio. If they did not, leave them out. Spoken
 * word gets in only if it is over music or delivered with some melody.
 * Unsung speech with no music behind it stays out."
 *
 * Applied per artist. Admission needs POSITIVE evidence of a released
 * recording credited to them as artist, tied to them BY ID:
 *   · their Wikidata Discogs id (P1953) is a main credit on a release
 *     this sweep ingested (creditedInSweep), or
 *   · that id is a main credit on any release in the local Discogs
 *     video index (mainCreditRefs).
 * A name match is never evidence (it verifies a name, not the claim —
 * standing lesson 1), and no evidence is not a pass (lesson 5).
 *
 * Spoken word: credits cannot show whether the speech is over music or
 * sung, so a spoken-word-only artist is never admitted by code — with a
 * release credit they are HELD for the owner's ear, without one they
 * are left out.
 *
 * Returns { decision: 'admit' | 'held' | 'out', basis }.
 */
export function ownerRuledDecision(person, { creditedInSweep = false, mainCreditRefs = [] } = {}) {
  const discogsId = person.discogsId != null && String(person.discogsId).trim() !== ''
    ? String(person.discogsId)
    : null
  const evidence = discogsId === null
    ? null
    : creditedInSweep
      ? 'discogs-main-credit-in-sweep'
      : mainCreditRefs.some((ref) => ref.kind === 'm')
        ? 'discogs-main-credit-video-index'
        : null
  const classes = ownerRuledClassesOf([...(person.occupations ?? [])])
  const spokenWordOnly = classes.length > 0 && classes.every((qid) => qid === SPOKEN_WORD)
  if (spokenWordOnly) {
    return evidence
      ? { decision: 'held', basis: `spoken word — ${evidence}; over music or sung needs the owner's ear` }
      : { decision: 'out', basis: discogsId === null ? 'spoken word — no Discogs id, no release evidence' : 'spoken word — no release credit' }
  }
  if (evidence) return { decision: 'admit', basis: evidence }
  return {
    decision: 'out',
    basis: discogsId === null ? 'no Discogs id — no release evidence' : 'no main-credit release found',
  }
}
