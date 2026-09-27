/**
 * THE definition of which Wikidata occupations put someone in the
 * gap-fill pool (owner go, Sep 2026 — the occupation-filter fix in the
 * handoff entry of Sep 20–21). Before this module there were three:
 * the sweep's exact 4 P106 + 1 P31, and two copies of a 12-QID
 * MUSICAL_PROFESSIONS (evidence-only). All three now read from here.
 *
 * ADMISSION NEEDS A PRESENT, LISTED OCCUPATION. The lists below are
 * explicit; nothing is admitted because it merely lacks a disqualifying
 * occupation, and there is no P279* subclass walk: a walk would pour
 * ~144 lyric poets (a songwriter-only batch import) into Yemen's pool
 * and admit Quran reciters, which Wikidata files under singer.
 *
 *   performer    listed P106 or P31 present → admitted as before.
 *   ownerRuled   only owner-ruled classes present (conductors, choir
 *                directors, record-producer-only, spoken word,
 *                arrangers, beatmakers) → admitted PER ARTIST only with
 *                positive evidence of a released original recording
 *                (see ownerRuledDecision in gapFillWikidata.mjs).
 *   null         nothing listed → not a candidate.
 *
 * The performer list is the legacy five plus exactly the classes behind
 * the 828 performer-class items of the Sep 21 probe
 * (data/occupation-filter-lists.json); scripts/test/music-occupations
 * .test.mjs pins that equivalence. Comments give the probe's count and
 * one artist it found under the class; labels are given where they
 * were settled in the Sep 20–21 review.
 *
 * Bump OCCUPATION_FILTER_VERSION whenever a list changes: the sweep
 * caches its Wikidata pass per country and re-runs it only when the
 * stamp differs (standing lesson 2).
 */

export const OCCUPATION_FILTER_VERSION = 'performer-allowlist-2026-09-21'

/** What the sweep admitted before this fix — exact matches only. */
export const LEGACY_P106 = new Set([
  'Q639669', // musician
  'Q177220', // singer
  'Q36834', // composer
  'Q488205', // singer-songwriter
])
export const LEGACY_P31 = new Set([
  'Q215380', // musical group
])

/** Performer occupations (P106). Legacy four first, then the probe's. */
export const PERFORMER_P106 = new Set([
  ...LEGACY_P106,
  'Q2252262', // rapper — 180, e.g. Tay Grin (MW)
  'Q2865819', // opera singer — 91, e.g. Bosba Panh (KH)
  'Q486748', // pianist — 78, e.g. Susana Elizeche (PY)
  'Q130857', // disc jockey — 57, e.g. Glive (PY)
  'Q1259917', // 56, e.g. Alexandra Bounxouei (LA)
  'Q855091', // guitarist — 30, e.g. Cayo Sila Godoy (PY)
  'Q102276804', // 29, e.g. Grace Chinga Moffat (MW)
  'Q13219637', // 27, e.g. Trần Thị Mơ (VN)
  'Q1062433', // 21, e.g. Aline Gahongayire (RW)
  'Q386854', // drummer — 18, e.g. Diego Cardozo (PY)
  'Q15981151', // jazz musician — 16, e.g. Alan Namoko (MW)
  'Q4351403', // 16, e.g. Cornelius Kweku Ganyo (GH)
  'Q63243029', // 15, e.g. Miriam Kuseni (MW)
  'Q3922505', // 13, e.g. Glive (PY)
  'Q806349', // bandleader — 11, e.g. Giovanni Ravenberg (SR)
  'Q112619698', // 10, e.g. Jean Claude Bamogo (BF)
  'Q1075651', // 9, e.g. Elio Rolando Cardozo (PY)
  'Q12800682', // 9, e.g. Vladi Strecker (KZ)
  'Q1278335', // 7, e.g. Bùi Gia Tường (VN)
  'Q2643890', // 7, e.g. Dima Bashar (PS)
  'Q55960555', // 6, e.g. Hoàng Rob (VN)
  'Q100493654', // 5, e.g. Mahmoud Jreri (PS)
  'Q118865', // 5, e.g. Herman Dijo (SR)
  'Q47409022', // 5, e.g. Тууганбай Абдиев (KG)
  'Q584301', // 5, e.g. Fredy Cardozo Fernández (PY)
  'Q73399344', // 5, e.g. Hồng Trang (VN)
  'Q765778', // 5, e.g. Herman Dijo (SR)
  'Q12377274', // 4, e.g. Herman Dijo (SR)
  'Q1415090', // 4, e.g. Khuat Duy Minh (VN)
  'Q7097633', // 4, e.g. آشوت ساسونتی (AM)
  'Q899758', // 4, e.g. Aleksandr Kosemyan (AM)
  'Q12902372', // 3, e.g. Jalal Ahmed (BD)
  'Q13391399', // 3, e.g. Joseph Hans Peters (HT)
  'Q3127709', // 3, e.g. Carmen Alice Acosta Franco (PY)
  'Q60723829', // 3, e.g. Carol Linda Addison-Lewis (TT)
  'Q10816969', // 2, e.g. Henk van Vliet (SR)
  'Q111167543', // 2, e.g. Faqir Muhammad Darwesh (AF)
  'Q12360214', // 2, e.g. Ariun-Erdene Ganbaatar (MN)
  'Q13167659', // 2, e.g. Тууганбай Абдиев (KG)
  'Q2532239', // 2, e.g. Sargis Baghdasaryan-Hopo (AM)
  'Q29169123', // 2, e.g. Евгений Иванович Простомолотов (KZ)
  'Q5371902', // 2, e.g. Julietta Vardanyan (AM)
  'Q59958430', // 2, e.g. Nguyễn Cường (VN)
  'Q61996187', // 2, e.g. Zvart Sarkissian (PS)
  'Q798487', // 2, e.g. Andrey Korolyov (KZ)
  'Q98523719', // 2, e.g. Sangie (MW)
  'Q98523757', // 2, e.g. Abdoul Jabbar (GN)
  'Q101084010', // 1, Ochiryn Dashdeleg (MN)
  'Q101584469', // 1, Aleksandr Belyakov (KZ)
  'Q1031332', // 1, Nathan Daoudou (BJ)
  'Q104218554', // 1, Alessandro Di Martino (NI)
  'Q117973670', // 1, Trương Duy Toản (VN)
  'Q1214796', // 1, Nikoghayos Vardanyan (AM)
  'Q122499964', // 1, Yousif Latif Jaralla (IQ)
  'Q12374149', // 1, Andrey Korolyov (KZ)
  'Q124738259', // 1, Rashed Khaled Al-Khadher (KW)
  'Q13424456', // 1, Billema Kwillia (LR)
  'Q1755412', // 1, Deepal Silva (LK)
  'Q1863064', // 1, Gusje Ost (SR)
  'Q21166956', // 1, Daud Khan (AF)
  'Q21680699', // 1, Abd al-Muhsin al-Rifa'i (KW)
  'Q24067349', // 1, Cayo Sila Godoy (PY)
  'Q2495709', // 1, گوسان زاکاریان (AM)
  'Q3153559', // 1, Abdou Benito (CM)
  'Q5024685', // 1, Julian Whiterose (TT)
  'Q5358395', // 1, KamRed (BZ)
  'Q55977806', // 1, Phạm Thị Trà My (VN)
  'Q57936775', // 1, Thái Hoàng (VN)
  'Q60614352', // 1, John KAMBALE MUVUNGA (CD)
  'Q60792477', // 1, haj marzugh karbalaei (IQ)
  'Q61947786', // 1, Giveton Gelin (BS)
  'Q66370835', // 1, Nani Pale (BF)
  'Q71194203', // 1, Hk la Decko07 (CD)
  'Q7832358', // 1, Adja Mbana Diop (SN)
  'Q81729632', // 1, Hom Nath Upadhyaya (NP)
  'Q88189094', // 1, Constantin Moscovici (MD)
  'Q956365', // 1, Timo Flloko (AL)
])

/** Performing groups (P31): band, duo and choir subtypes. */
export const PERFORMER_P31 = new Set([
  ...LEGACY_P31,
  'Q9212979', // musical duo — 13, e.g. Dream Boys (RW)
  'Q56816954', // 12, e.g. Beerdigungs Lauten (AM)
  'Q5741069', // rock band — 11, e.g. Crimesterdam (AM)
  'Q113292621', // 7, e.g. Հայ աշուղներ (համույթ) (AM)
  'Q131186', // choir — 7, e.g. Harmonious Chorale (GH)
  'Q641066', // 7, e.g. M.viiz (LA)
  'Q19464263', // 3, e.g. Kaïdan Gaskia (NE)
  'Q1753063', // 2, e.g. Imani Milele Choir (UG)
  'Q216337', // 2, e.g. Quả Dưa Hấu (VN)
  'Q1684352', // 1, Centraal (SR)
  'Q1723154', // 1, Երեւանի պետական սենեկային երգչախումբ (AM)
  'Q2707384', // 1, Hogh (AM)
  'Q7229089', // 1, Non-Stop (KG)
])

/** Owner-ruled classes (Sep 21, 2026) — admitted per artist, never per class. */
export const SPOKEN_WORD = 'Q17378128'
export const OWNER_RULED_P106 = new Set([
  'Q183945', // record producer
  'Q158852', // conductor
  'Q1076502', // choir director
  'Q42227156', // chorus master
  'Q691031', // concertmaster
  'Q1643514', // music arranger
  SPOKEN_WORD, // spoken word artist
  'Q4087517', // beatmaker
])

/**
 * Reached by a subclass walk but NOT performers; never admit on their
 * own. The sweep does not query them at all — listed so the probe can
 * bucket them and so a class can never be both admitted and excluded.
 */
export const EXCLUDED_P106 = new Set([
  'Q753110', // songwriter
  'Q16145150', // music educator
  'Q81759238', // music professor
  'Q3595924', // qāriʾ
  'Q23037330', // reciter
  'Q625163', // hafiz
  'Q10730252', // radio DJ
  'Q7939609', // voice teacher
  'Q101572682', // guitar teacher
])

/**
 * Carried from the retired 12-QID evidence list and not otherwise
 * listed here; kept only so the held-rerun `musician` evidence flag
 * never narrows. Admits nobody.
 */
const LEGACY_EVIDENCE_ONLY = new Set(['Q128124'])

const split = (tagged) => {
  const at = tagged.indexOf(':')
  return at > 0 ? [tagged.slice(0, at), tagged.slice(at + 1)] : [null, null]
}

/**
 * Admission bucket for one item's occupations, given as 'P106:Qn' /
 * 'P31:Qn' strings. A class only counts when it is PRESENT and LISTED;
 * an empty or unlisted set is null, never a pass.
 */
export function classifyOccupations(tagged) {
  let ownerRuled = false
  for (const entry of tagged ?? []) {
    const [via, qid] = split(entry)
    if (via === 'P106' && PERFORMER_P106.has(qid)) return 'performer'
    if (via === 'P31' && PERFORMER_P31.has(qid)) return 'performer'
    if (via === 'P106' && OWNER_RULED_P106.has(qid)) ownerRuled = true
  }
  return ownerRuled ? 'ownerRuled' : null
}

/** Owner-ruled classes present on an item (bare QIDs). */
export function ownerRuledClassesOf(tagged) {
  return (tagged ?? [])
    .map(split)
    .filter(([via, qid]) => via === 'P106' && OWNER_RULED_P106.has(qid))
    .map(([, qid]) => qid)
}

/** Did the sweep's old exact filter admit this item? (probe diagnostics) */
export function passesLegacyFilter(tagged) {
  return (tagged ?? []).some((entry) => {
    const [via, qid] = split(entry)
    return via === 'P106' ? LEGACY_P106.has(qid) : via === 'P31' && LEGACY_P31.has(qid)
  })
}

/**
 * Evidence flag for the held-ruling reruns: does Wikidata say this
 * person works in music at all? Wider than admission on purpose
 * (songwriters and every owner-ruled class count); gates nothing.
 */
export function isMusicalProfession(qid) {
  return (
    PERFORMER_P106.has(qid) ||
    OWNER_RULED_P106.has(qid) ||
    qid === 'Q753110' || // songwriter
    LEGACY_EVIDENCE_ONLY.has(qid)
  )
}

/** SPARQL VALUES list, e.g. "wd:Q1 wd:Q2". */
export const sparqlValues = (qids) => [...qids].map((qid) => `wd:${qid}`).join(' ')
