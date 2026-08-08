/**
 * Arbitrate the raw begin-area sweep into moves safe to publish.
 *
 * Birthplace ALONE is not musical origin: it strips Davido from
 * Nigeria, Luis Miguel from Mexico, Alison Hinds from Barbados —
 * artists born abroad whose music is wholly of the country. That is
 * the mirror image of the bug being fixed, so every flagged artist is
 * arbitrated against Wikidata (citizenship + the curated one-line
 * description) before anything moves.
 *
 * Order of evidence, most decisive first:
 *   1. "<Nationality>-born ..." in the description — Wikidata's own way
 *      of saying where someone STARTED (Tina Turner: "American-born
 *      Swiss singer"). Decisive even when they later naturalised.
 *   2. A non-musical profession with no musical word — the MBID→
 *      Wikidata join is wrong (Gustav Mahler resolving to a German
 *      mathematician). Never act on bad data.
 *   3. Citizenship of the pool country → they belong there; keep.
 *   4. The pool country's nationality adjective in the description
 *      ("Irish musician" while being moved out of Ireland) → keep.
 *   5. No Wikidata evidence at all → keep. No opinion, no change.
 *
 * Input:  lib/explore/origin-corrections.json (raw sweep) + the
 *         Wikidata arbitration dump keyed by MBID.
 * Output: the same file, filtered to the defensible moves.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const CORRECTIONS = 'lib/explore/origin-corrections.json'
const ARBITRATION = process.argv[2] ?? '/tmp/wd_arbitration.json'
const REPORT = 'data/origin-arbitration-report.json'

/** ISO → the nationality adjective Wikidata descriptions actually use. */
const ADJECTIVES = {
  AE: 'Emirati', AR: 'Argentine', AT: 'Austrian', AU: 'Australian',
  BB: 'Barbadian', BE: 'Belgian', BR: 'Brazilian', BS: 'Bahamian',
  CA: 'Canadian', CH: 'Swiss', CL: 'Chilean', CN: 'Chinese',
  CO: 'Colombian', CR: 'Costa Rican', CU: 'Cuban', CV: 'Cape Verdean',
  CY: 'Cypriot', CZ: 'Czech', DE: 'German', DK: 'Danish', EE: 'Estonian',
  ES: 'Spanish', FI: 'Finnish', FR: 'French', GB: 'British', GR: 'Greek',
  HK: 'Hong Kong', ID: 'Indonesian', IE: 'Irish', IL: 'Israeli',
  IN: 'Indian', IR: 'Iranian', IS: 'Icelandic', IT: 'Italian',
  JM: 'Jamaican', JP: 'Japanese', KR: 'Korean', LA: 'Laotian',
  LB: 'Lebanese', LI: 'Liechtenstein', LK: 'Sri Lankan', LU: 'Luxembourgish',
  MT: 'Maltese', MX: 'Mexican', MY: 'Malaysian', NG: 'Nigerian',
  NL: 'Dutch', NO: 'Norwegian', NZ: 'New Zealand', PA: 'Panamanian',
  PH: 'Filipino', PL: 'Polish', PR: 'Puerto Rican', PT: 'Portuguese',
  PY: 'Paraguayan', RU: 'Russian', SE: 'Swedish', SG: 'Singaporean',
  SY: 'Syrian', TH: 'Thai', TR: 'Turkish', UA: 'Ukrainian',
  US: 'American', UY: 'Uruguayan', ZA: 'South African',
}

const BY_ADJECTIVE = new Map(
  Object.entries(ADJECTIVES).map(([iso, adjective]) => [
    adjective.toLowerCase(),
    iso,
  ]),
)

const MUSICAL = /singer|musician|composer|band|rapper|\bdj\b|guitar|drum|pianist|songwriter|producer|orchestra|vocal|violin|saxophon|trumpet|cellist|conductor|duo|group|rock|jazz|folk|hop|artist|performer|bassist|flaut|organist|percussion/i
const NON_MUSICAL = /mathematician|politician|footballer|physicist|chemist|philosopher|economist|historian|athlete|novelist|painter|scientist|engineer|lawyer|journalist|entrepreneur|businessman/i

/**
 * Documented musical fact beats the birth record. Each of these is a
 * case where the automated rules are LITERALLY right and editorially
 * wrong — an artist born abroad whose music is inseparable from the
 * country the sweep wanted to remove them from, or a resolution the
 * area tree cannot be trusted on.
 */
const KEEP_OVERRIDES = {
  'Jean‐Baptiste Lully': 'Italian-born, but the founder of French opera; naturalised 1661, whole career at the French court',
  'Jacques Offenbach': 'Cologne-born, but the creator of French operetta; naturalised French, whole career in Paris',
  'Robert Miles': 'born in Fleurier but raised in Italy; the Dream House records are Italian',
  'Barry Gibb': 'born on the Isle of Man, but the Bee Gees began in Brisbane',
  'Vicente Ascone': 'Italian-born, emigrated as a child; a foundational Uruguayan composer',
  'Yasmin Levy': "Israeli singer born in Jerusalem — MusicBrainz's area tree resolves Jerusalem in a way this project will not adjudicate",
  'Rudolf Serkin': 'born in Cheb, Bohemia; the resolved target does not match his documented birthplace',
  'Joseph Schmidt': 'born in Bukovina under shifting empires; career Austrian/German',
  'Leopold Godowsky': 'born near Vilnius under the Russian Empire; canonically Polish-American',
}

function decide(move, info) {
  const override = KEEP_OVERRIDES[move.name]
  if (override) return { keep: true, why: `override: ${override}` }
  if (!info) return { keep: true, why: 'no-wikidata-entry' }

  const desc = info.desc ?? ''
  // 1. "<Nationality>-born" — where they actually started.
  const bornMatch = desc.match(/([A-Za-z][A-Za-z ]*?)-born/)
  if (bornMatch) {
    const iso = BY_ADJECTIVE.get(bornMatch[1].trim().toLowerCase())
    if (iso && iso !== move.from) {
      return { keep: false, why: `described "${bornMatch[1]}-born"`, to: iso }
    }
    if (iso === move.from) {
      return { keep: true, why: `described "${bornMatch[1]}-born" (this country)` }
    }
  }

  // 2. Wrong join: a non-musical profession with no musical word.
  if (NON_MUSICAL.test(desc) && !MUSICAL.test(desc)) {
    return { keep: true, why: 'wikidata join looks wrong (non-musical)' }
  }

  // 3. Citizenship of the pool country.
  if ((info.isos ?? []).includes(move.from)) {
    return { keep: true, why: 'holds citizenship of this country' }
  }

  // 4. Described with this country's nationality.
  const adjective = ADJECTIVES[move.from]
  if (adjective && new RegExp(`\\b${adjective}\\b`, 'i').test(desc)) {
    return { keep: true, why: `described "${adjective}"` }
  }

  // 5. No citizenship data at all — no opinion.
  if ((info.isos ?? []).length === 0) {
    return { keep: true, why: 'no citizenship data' }
  }

  return {
    keep: false,
    why: `citizen of ${info.isos.join('/')}, not ${move.from}`,
  }
}

const raw = JSON.parse(readFileSync(CORRECTIONS, 'utf8'))
const arbitration = JSON.parse(readFileSync(ARBITRATION, 'utf8'))

const kept = []
const published = {}
for (const [mbid, move] of Object.entries(raw.moves)) {
  const verdict = decide(move, arbitration[mbid])
  if (verdict.keep) {
    kept.push({ ...move, mbid, why: verdict.why })
    continue
  }
  published[mbid] = { ...move, to: verdict.to ?? move.to, why: verdict.why }
}

writeFileSync(
  CORRECTIONS,
  JSON.stringify(
    { generatedAt: raw.generatedAt, arbitratedAt: new Date().toISOString().slice(0, 10), moves: published },
    null,
    2,
  ),
)
writeFileSync(
  REPORT,
  JSON.stringify(
    {
      flagged: Object.keys(raw.moves).length,
      published: Object.keys(published).length,
      keptInPlace: kept.length,
      keptReasons: kept.reduce((acc, entry) => {
        acc[entry.why] = (acc[entry.why] ?? 0) + 1
        return acc
      }, {}),
      publishedMoves: Object.values(published)
        .sort((a, b) => b.weight - a.weight)
        .map((m) => `${m.from}→${m.to} ${m.name} (${m.why})`),
    },
    null,
    2,
  ),
)
console.log(
  `flagged ${Object.keys(raw.moves).length} → published ${Object.keys(published).length}, kept ${kept.length}`,
)
