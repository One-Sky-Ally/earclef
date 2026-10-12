/**
 * "Songs about this place" (owner go, Oct 12 2026) — the pure rules.
 *
 * SOURCE: en.wikipedia's "Songs about <place>" categories, the only
 * usable source measured (Wikidata's main-subject link covers 641
 * songs about any place; MusicBrainz has no such relation). A category
 * is mapped to one of the globe's places — a country, a US state, a UK
 * nation, or a city — and a song in that category is listed under the
 * place AND, by the owner's ruling, under the place's country,
 * labelled with the specific place ("about Paris").
 *
 * Every comparison is exact normalized equality; nothing is inferred
 * from a song title. Only songs with a playability-checked video are
 * ever served (owner: "I don't want to tease music people can't
 * listen to").
 */

export const norm = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^the /, '')
    .replace(/[^a-z0-9]+/g, '')

/** Wikipedia spellings that Intl's region names do not produce. */
const COUNTRY_EXTRAS = {
  unitedstatesofamerica: 'US', usa: 'US', america: 'US', britain: 'GB', greatbritain: 'GB',
  russia: 'RU', southkorea: 'KR', northkorea: 'KP', vietnam: 'VN', iran: 'IR', syria: 'SY',
  czechrepublic: 'CZ', czechia: 'CZ', ivorycoast: 'CI', netherlands: 'NL', holland: 'NL',
  republicofireland: 'IE', ireland: 'IE', bolivia: 'BO', venezuela: 'VE', tanzania: 'TZ',
  laos: 'LA', moldova: 'MD', macedonia: 'MK', northmacedonia: 'MK', palestine: 'PS',
  kosovo: 'XK', taiwan: 'TW', hongkong: 'HK', macau: 'MO', vaticancity: 'VA', burma: 'MM',
  myanmar: 'MM', eastgermany: 'DE', westgermany: 'DE', sovietunion: 'RU', yugoslavia: 'RS',
  czechoslovakia: 'CZ', congo: 'CD', drcongo: 'CD', democraticrepublicofthecongo: 'CD',
  republicofthecongo: 'CG', brunei: 'BN', bahamas: 'BS', gambia: 'GM', philippines: 'PH',
  maldives: 'MV', micronesia: 'FM', saotomeandprincipe: 'ST', capeverde: 'CV', eswatini: 'SZ',
  swaziland: 'SZ', timorleste: 'TL', easttimor: 'TL', tibet: 'CN', puertorico: 'PR',
}

/** UK nations by name → region code. */
const UK_NATION_EXTRAS = { england: 'GB-ENG', scotland: 'GB-SCT', wales: 'GB-WLS', northernireland: 'GB-NIR' }

/**
 * City spellings Wikipedia uses that differ from the globe's chapter
 * place names, and cities with a category but no chapter — each named
 * with its country so the song still reaches the country panel.
 */
const CITY_EXTRAS = {
  newyorkcity: ['US', 'New York City'], newyork: ['US', 'New York City'], rome: ['IT', 'Roma'],
  vienna: ['AT', 'Vienna'], munich: ['DE', 'Munich'], prague: ['CZ', 'Prague'], lisbon: ['PT', 'Lisbon'],
  moscow: ['RU', 'Moscow'], copenhagen: ['DK', 'Copenhagen'], brussels: ['BE', 'Brussels'],
  losangeles: ['US', 'Los Angeles'], london: ['GB', 'London'], paris: ['FR', 'Paris'], berlin: ['DE', 'Berlin'],
  tokyo: ['JP', 'Tokyo'], detroit: ['US', 'Detroit'], sainttropez: ['FR', 'Saint-Tropez'],
  bethlehem: ['PS', 'Bethlehem'], lahore: ['PK', 'Lahore'], stlouis: ['US', 'St. Louis'],
  cincinnati: ['US', 'Cincinnati'], louisville: ['US', 'Louisville'], tulsa: ['US', 'Tulsa'],
  chattanooga: ['US', 'Chattanooga'], dublin: ['IE', 'Dublin'], riodejaneiro: ['BR', 'Rio de Janeiro'],
  buenosaires: ['AR', 'Buenos Aires'], barcelona: ['ES', 'Barcelona'], amsterdam: ['NL', 'Amsterdam'],
  beijing: ['CN', 'Beijing'], liverpool: ['GB', 'Liverpool'], stockholm: ['SE', 'Stockholm'],
  neworleans: ['US', 'New Orleans'], chicago: ['US', 'Chicago'], sanfrancisco: ['US', 'San Francisco'],
  atlanta: ['US', 'Atlanta'], boston: ['US', 'Boston'], memphis: ['US', 'Memphis'],
  philadelphia: ['US', 'Philadelphia'], miami: ['US', 'Miami'], lasvegas: ['US', 'Las Vegas'],
}

/**
 * Build the lookup maps once from the globe's own place lists.
 * `cities` are "CC|Place" keys from the presence edges (chapter cities).
 */
export function placeMaps({ codes, countryNames, usStates, ukNations, cities }) {
  const intl = new Intl.DisplayNames(['en'], { type: 'region' })
  const countryByName = new Map()
  for (const code of codes) {
    let intlName = null
    try { intlName = intl.of(code) } catch { intlName = null }
    for (const name of [countryNames[code], intlName]) if (name) countryByName.set(norm(name), code)
  }
  for (const [key, code] of Object.entries(COUNTRY_EXTRAS)) if (!countryByName.has(key)) countryByName.set(key, code)
  const stateByName = new Map(usStates.map((state) => [norm(state.name), { code: state.code, name: state.name }]))
  const nationByName = new Map(ukNations.map((nation) => [norm(nation.name), { code: nation.code, name: nation.name }]))
  for (const [key, code] of Object.entries(UK_NATION_EXTRAS)) if (!nationByName.has(key)) nationByName.set(key, { code, name: key })
  const cityByName = new Map()
  for (const key of cities) {
    const [cc, city] = key.split('|')
    cityByName.set(norm(city), [cc, city])
  }
  for (const [key, value] of Object.entries(CITY_EXTRAS)) cityByName.set(key, value)
  return { countryByName, stateByName, nationByName, cityByName }
}

const CATEGORY = /^Category:Songs (?:about|set in) (?:the )?(.+)$/i

/**
 * One category → one place, or null when the subject is not a place
 * the globe has (politics, rivers, oceans, "cities" itself…).
 * The parenthetical is read FIRST: "Georgia (U.S. state)" is a state,
 * never the country.
 */
export function classifyCategory(title, maps) {
  const match = title.match(CATEGORY)
  if (!match) return null
  const paren = match[1].match(/\(([^)]*)\)$/)?.[1] ?? ''
  const subject = match[1].replace(/\s*\([^)]*\)$/, '').trim()
  const key = norm(subject)
  if (!key) return null
  const state = maps.stateByName.get(key)
  const nation = maps.nationByName.get(key)
  const country = maps.countryByName.get(key)
  const city = maps.cityByName.get(key)
  if (/u\.?s\.? state/i.test(paren) && state) return { kind: 'us-state', key: state.code, name: state.name, country: 'US' }
  if (/country/i.test(paren) && country) return { kind: 'country', key: country, name: subject, country }
  if (/city/i.test(paren) && city) return { kind: 'city', key: `${city[0]}|${city[1]}`, name: city[1], country: city[0] }
  if (nation) return { kind: 'uk-nation', key: nation.code, name: nation.name, country: 'GB' }
  if (country) return { kind: 'country', key: country, name: subject, country }
  if (state) return { kind: 'us-state', key: state.code, name: state.name, country: 'US' }
  if (city) return { kind: 'city', key: `${city[0]}|${city[1]}`, name: city[1], country: city[0] }
  // "Houston, Texas" / "Tulsa, Oklahoma": a city named with its state.
  const parts = subject.split(', ')
  if (parts.length === 2 && maps.stateByName.has(norm(parts[1]))) {
    const known = maps.cityByName.get(norm(parts[0]))
    return known
      ? { kind: 'city', key: `${known[0]}|${known[1]}`, name: known[1], country: known[0] }
      : { kind: 'city', key: `US|${parts[0]}`, name: parts[0], country: 'US' }
  }
  return null
}

/** "List of songs about Paris" is an article, not a song. */
export function isListArticle(title) {
  return /^Lists? of /i.test(title)
}

/** The place keys a song listed under `place` is served under: its own, and its country's. */
export function servedUnder(place) {
  return place.kind === 'country' ? [place.key] : [place.key, place.country]
}

/**
 * Alternate-version markers, read against the upload's ANNOTATION
 * (title minus artist and song). A remix, a live take or a demo is the
 * song, so it may play — but the plain record wins when one exists,
 * and the version is shown. "Remastered", "official", "HD" and the
 * like are not versions.
 */
export const VERSION_MARKERS =
  /(?<![\p{L}\p{N}])(remix|remixes|dub|live|instrumental|demo|acoustic|rework|extended|unplugged|session|cover|alternate|alternative|take \d+|edit|mix|version|versione|versión|reprise|medley|sped up|slowed|mashup|bootleg)(?![\p{L}\p{N}])/iu

/** Named by meaning, not by position: "extended remix" is a remix. */
const VERSION_WORDS = [
  ['remix', /(?<![\p{L}\p{N}])remix(es)?(?![\p{L}\p{N}])/iu],
  ['live', /(?<![\p{L}\p{N}])(live|unplugged|session)(?![\p{L}\p{N}])/iu],
  ['demo', /(?<![\p{L}\p{N}])demo(?![\p{L}\p{N}])/iu],
  ['acoustic', /(?<![\p{L}\p{N}])acoustic(?![\p{L}\p{N}])/iu],
  ['instrumental', /(?<![\p{L}\p{N}])instrumental(?![\p{L}\p{N}])/iu],
  ['cover', /(?<![\p{L}\p{N}])cover(?![\p{L}\p{N}])/iu],
  ['dub', /(?<![\p{L}\p{N}])dub(?![\p{L}\p{N}])/iu],
  ['alternate', /(?<![\p{L}\p{N}])(alternate|alternative|take \d+|reprise|medley|mashup|bootleg|sped up|slowed)(?![\p{L}\p{N}])/iu],
  ['edit', /(?<![\p{L}\p{N}])(rework|extended|edit|mix|version|versione|versión)(?![\p{L}\p{N}])/iu],
]

export function versionOf(annotation) {
  const text = annotation ?? ''
  for (const [name, pattern] of VERSION_WORDS) if (pattern.test(text)) return name
  return null
}

const TIER = { 'official-video': 0, audio: 1, video: 2 }

/**
 * Rank playable candidates: plain record before any version, then
 * official video → audio → video, then the order found.
 */
export function rankCandidates(candidates) {
  return [...candidates]
    .map((candidate, order) => ({ candidate, order }))
    .sort(
      (a, b) =>
        (a.candidate.version ? 1 : 0) - (b.candidate.version ? 1 : 0) ||
        TIER[a.candidate.kind] - TIER[b.candidate.kind] ||
        a.order - b.order,
    )
    .map(({ candidate }) => candidate)
}
