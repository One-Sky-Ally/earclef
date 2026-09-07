/**
 * PROFILE-ORIGIN RULE (owner ruling, Sep 7, 2026).
 *
 * A Discogs artist profile is volunteer prose, but it is an INDEPENDENT
 * source (standing lesson 3): "Kamoliddin Rakhimov – Uzbek folk singer.
 * 1943 — 2015." corroborates a Tashkent-pressed credit the way
 * Racciatti's profile corroborated his MusicBrainz dates. The ruling:
 *
 *   claim      an explicit NATIONALITY / ORIGIN statement for the pool
 *              country ("Uzbek singer", "from Tajikistan", "Honored
 *              Artist of the Kirghiz SSR") → SHIPS, basis profile-origin
 *   mixed      a claim for the pool country AND for another nation
 *              ("Soviet, Uzbek and Russian composer") → ships,
 *              KEEP-WITH-NOTE (the profile line becomes the note)
 *   born-only  the pool country appears ONLY inside a birth clause
 *              ("Russian jazz pianist (* 1951 in Tashkent)") → HELD for
 *              the owner (the Asunción test: birthplace is not presence)
 *   foreign    claims only for other nations → not this pool's
 *   none       no signal
 *
 * "Soviet"/"USSR" is neutral (the predecessor state contains the pool);
 * ethnonyms without a state (Bukharan, Uyghur, Koryo-saram) are neutral.
 * A birth clause runs from a birth keyword to the end of its sentence
 * or bracket; terms inside it never count as a claim.
 *
 * Patterns are built with Unicode boundaries: JavaScript's \b and \w
 * are ASCII-only and would never match "Узбекский".
 */

const L = '\\p{L}'
/** Alternatives → one case-insensitive, Unicode-bounded regex. */
const term = (alternatives) =>
  new RegExp(`(?<![${L}\\p{N}])(?:${alternatives.join('|')})(?![${L}\\p{N}])`, 'iu')

const POOL_LISTS = {
  UZ: {
    claim: [`uzbek(?:istani)?`, `usbek${L}*`, `ouzbek${L}*`, `узбек${L}*`, `ўзбек${L}*`, `o[ʻ'‘’]?zbek${L}*`],
    place: ['uzbekistan', `узбекистан${L}*`, 'tashkent', 'toshkent', `ташкент${L}*`, 'samarkand', `самарканд${L}*`, 'bukhara', 'bokhara', `бухар${L}*`, 'fergana', 'ferghana', 'фергана', 'andijan', `андижан${L}*`, 'namangan', `наманган${L}*`, 'khiva', 'хива', 'urgench', `ургенч${L}*`, 'nukus', 'нукус', 'termez', `термез${L}*`, 'kokand', `коканд${L}*`, 'lebob', 'karshi', 'карши'],
  },
  TJ: {
    claim: [`tajik(?:istani)?`, 'tadjik', 'tadzhik', `tadschik${L}*`, `таджик${L}*`, `тоҷик${L}*`],
    place: ['tajikistan', `таджикистан${L}*`, 'dushanbe', 'душанбе', 'stalinabad', `сталинабад${L}*`, 'khujand', 'khodjent', 'leninabad', `ленинабад${L}*`, `худжанд${L}*`, 'kulob', 'kulyab', `куляб${L}*`, 'khorog', `хорог${L}*`, `pamir${L}*`, `памир${L}*`],
  },
  KG: {
    claim: [`kyrgyz(?:stani)?`, `kirghiz(?:ian)?`, 'kirgiz', `kirgisisch${L}*`, `киргиз${L}*`, `кыргыз${L}*`],
    place: ['kyrgyzstan', 'kirghizia', 'kirgizia', 'киргизия', `кыргызстан${L}*`, 'bishkek', 'бишкек', 'frunze', 'фрунзе', 'osh', 'ош', 'issyk[- ]?kul', `иссык[- ]?куль${L}*`, 'naryn', 'нарын'],
  },
  TM: {
    claim: [`turkmen(?:istani)?`, 'turkmenian', `туркмен${L}*`, `türkmen${L}*`],
    // The city of Mary is left out in Latin script ("Mary Poppins" put
    // Julie Andrews on Turkmenistan's held list); the Cyrillic form stays.
    place: ['turkmenistan', 'turkmenia', 'туркмения', `туркменистан${L}*`, 'ashgabat', 'ashkhabad', `ашхабад${L}*`, 'мары', 'chardzhou', 'charjew', 'чарджоу', 'turkmenabat', 'krasnovodsk', `красноводск${L}*`, 'dashoguz', 'tashauz', 'ташауз'],
  },
  KZ: {
    claim: [`kazakh(?:stani)?`, `kasach${L}*`, `казах${L}*`, `қазақ${L}*`],
    place: ['kazakhstan', `казахстан${L}*`, 'almaty', 'alma[- ]?ata', 'алма[- ]?ата', 'алматы', 'astana', 'астана', 'nur-sultan', 'karaganda', `караганд${L}*`, 'shymkent', 'chimkent', 'чимкент', 'шымкент', 'semipalatinsk', `семипалатинск${L}*`, 'semey', 'pavlodar', `павлодар${L}*`, 'aktobe', `актюбинск${L}*`, 'uralsk', `уральск${L}*`, 'kokshetau', 'kokchetav', `кокчетав${L}*`, 'taraz', 'dzhambul', `джамбул${L}*`, 'kyzylorda', 'кзыл-орда', 'ust-kamenogorsk', `усть-каменогорск${L}*`, 'petropavlovsk', `петропавловск${L}*`],
  },
}

/** Country NAMES (first entries of each place list) used attributively. */
const COUNTRY_NAMES = {
  UZ: ['uzbekistan', `узбекистан${L}*`],
  TJ: ['tajikistan', `таджикистан${L}*`],
  KG: ['kyrgyzstan', 'kirghizia', 'kirgizia', 'киргизия', `кыргызстан${L}*`],
  TM: ['turkmenistan', 'turkmenia', 'туркмения', `туркменистан${L}*`],
  KZ: ['kazakhstan', `казахстан${L}*`],
}
const ROLE_NOUNS =
  'orchestra|ensemble|choir|chorus|philharmonic|radio|television|theat\\p{L}*|conservator\\p{L}*|opera|ballet|band|group|quartet|trio|folk|state|national|singer|composer|musician|conductor|pianist|violinist|guitarist|poet|оркестр\\p{L}*|ансамбл\\p{L}*|хор\\p{L}*|филармон\\p{L}*|театр\\p{L}*|певец|певица|композитор\\p{L}*|музыкант\\p{L}*'

const POOL_TERMS = Object.fromEntries(
  Object.entries(POOL_LISTS).map(([code, lists]) => [
    code,
    {
      claim: term(lists.claim),
      place: term(lists.place),
      // "from Uzbekistan", "from Soviet Uzbekistan", "из Ташкента":
      // up to two adjectives may sit between the preposition and the
      // place. "in" is deliberately absent — activity is not origin.
      from: new RegExp(
        `(?<![${L}])(?:from|of|из)\\s+(?:${L}+\\s+){0,2}(?:${lists.place.join('|')})(?![${L}\\p{N}])`,
        'iu',
      ),
      // "Uzbekistan State Symphony Orchestra", "Kyrgyzstan (state)
      // orchestra of folk instruments": the country name attributively
      // naming an institution is an origin claim.
      attributive: new RegExp(
        `(?<![${L}])(?:${COUNTRY_NAMES[code].join('|')})\\s+(?:\\(\\p{L}+\\)\\s+)?(?:${L}+\\s+){0,2}(?:${ROLE_NOUNS})(?![${L}])`,
        'iu',
      ),
      // Inside a birth clause only PLACE phrases are neutral — "Uzbek
      // SSR", "Tashkent, Uzbekistan" — a bare demonym + role ("Born
      // 1939, Uzbek composer") is still a claim.
      birthPlace: new RegExp(
        `(?:(?:${lists.claim.join('|')})\\s+(?:a?ssr|soviet socialist republic|republic|ссР|АССР|ССР)|${lists.place.join('|')})`,
        'giu',
      ),
    },
  ]),
)

/** Other nations' demonyms — a claim here makes "mixed" or "foreign". */
const OTHER_NATIONS = [
  ['RU', term(['russian', `russisch${L}*`, `русск${L}*`, `россий${L}*`])],
  ['UA', term(['ukrainian', `украин${L}*`, `україн${L}*`])],
  ['AM', term(['armenian', `армян${L}*`])],
  ['AZ', term(['azerbaijani', 'azeri', `азербайджан${L}*`])],
  ['GE', term(['georgian', `грузин${L}*`])],
  ['BY', term(['belarusian', 'byelorussian', `белорус${L}*`, `беларус${L}*`])],
  ['MD', term(['moldovan', 'moldavian', `молдав${L}*`])],
  ['LV', term(['latvian', `латыш${L}*`, `латвий${L}*`])],
  ['LT', term(['lithuanian', `литов${L}*`])],
  ['EE', term(['estonian', `эстон${L}*`])],
  ['PL', term(['polish', `польск${L}*`])],
  ['DE', term(['german', `немецк${L}*`])],
  ['KR', term(['korean', `корей${L}*`])],
  ['TT', term(['tatar', `татар${L}*`])],
  ['IR', term(['iranian', 'persian', `иран${L}*`, `персид${L}*`])],
  ['AF', term(['afghan', `афган${L}*`])],
  ['TR', term(['turkish', `турецк${L}*`])],
  ['US', term(['american', `американ${L}*`])],
  // "English" is left out: profiles say "in English:" for transliterations.
  ['GB', term(['british', `британ${L}*`, `англичан${L}*`])],
  ['FR', term(['french', `француз${L}*`])],
]

/**
 * Birth clauses: from a birth keyword to the end of the sentence or the
 * enclosing bracket. "(* 1951 in Tashkent)" and "born 10 February 1941,
 * Dushanbe" are both clauses; "родился в Ташкенте" too.
 */
const BIRTH_CLAUSE = new RegExp(
  `(?:(?<![${L}])born(?![${L}])|(?<![${L}])b\\.\\s|(?<![${L}])née?(?![${L}])|(?<![${L}])geb(?:oren|\\.)?(?![${L}])|родил(?:ся|ась)|(?<![${L}])род\\.\\s|\\(\\s*\\*\\s*\\d{4}|(?<![${L}])nat[oa](?![${L}])|(?<![${L}])nacid[oa](?![${L}]))[^.;)\\n]*`,
  'giu',
)

/**
 * Neutralise the PLACE phrases inside birth clauses (the birthplace is
 * not presence) while leaving any demonym-as-role in them intact.
 */
function neutraliseBirthPlaces(text, terms) {
  return text.replace(BIRTH_CLAUSE, (clause) => clause.replace(terms.birthPlace, ' '))
}

/**
 * Classify one profile against one pool country.
 * Returns { verdict, poolClaim, foreignClaims, excerpt }.
 */
export function classifyProfile(profile, poolCode) {
  const terms = POOL_TERMS[poolCode]
  const text = (profile ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!terms || !text) return { verdict: 'none', poolClaim: null, foreignClaims: [], excerpt: '' }
  const outsideBirth = neutraliseBirthPlaces(text, terms)
  // A one-word profile that IS the country ("Kazakhstan.") is a claim:
  // Discogs contributors file origin that way for minor Soviet-era acts.
  const bare = text.replace(/[.\s]+$/u, '')
  const wholeProfileCountry =
    Object.keys(COUNTRY_NAMES).find((code) =>
      new RegExp(`^(?:${COUNTRY_NAMES[code].join('|')})$`, 'iu').test(bare),
    ) ?? null
  if (wholeProfileCountry && wholeProfileCountry !== poolCode) {
    return { verdict: 'foreign', poolClaim: null, foreignClaims: [wholeProfileCountry], excerpt: text.slice(0, 160) }
  }
  const poolClaim =
    (wholeProfileCountry === poolCode ? bare : null) ??
    outsideBirth.match(terms.claim)?.[0] ??
    outsideBirth.match(terms.from)?.[0] ??
    outsideBirth.match(terms.attributive)?.[0] ??
    null
  const otherCodes = new Set()
  for (const [code, pattern] of OTHER_NATIONS) {
    if (code !== poolCode && pattern.test(outsideBirth)) otherCodes.add(code)
  }
  for (const [code, other] of Object.entries(POOL_TERMS)) {
    if (code !== poolCode && other.claim.test(outsideBirth)) otherCodes.add(code)
  }
  const foreignClaims = [...otherCodes]
  const excerpt = text.slice(0, 160)
  if (poolClaim && foreignClaims.length > 0) return { verdict: 'mixed', poolClaim, foreignClaims, excerpt }
  if (poolClaim) return { verdict: 'claim', poolClaim, foreignClaims, excerpt }
  if (terms.claim.test(text) || terms.place.test(text)) {
    return { verdict: 'born-only', poolClaim: null, foreignClaims, excerpt }
  }
  if (foreignClaims.length > 0) return { verdict: 'foreign', poolClaim: null, foreignClaims, excerpt }
  return { verdict: 'none', poolClaim: null, foreignClaims: [], excerpt }
}

export const PROFILE_POOL_CODES = Object.keys(POOL_TERMS)
