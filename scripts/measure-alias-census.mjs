/**
 * MEASURE ONLY — zero quota. Which pooled MusicBrainz artists have a
 * non-Latin-script name AND a Latin-script alias of type "Artist name"
 * or "Legal name" (owner's rule), and where they sit on the globe.
 *
 * Pools are rebuilt per place and year the way countryDetails() does
 * (active that year, undated only from 1980, dated first then weight,
 * top 300). Origin corrections and self-filed pins are ignored — both
 * are tiny next to the stored rosters.
 *
 * Owner brief Nov 18, 2026 (Egypt 1966 follow-up). Reads the local
 * MB dump indexes (data/mb-dump/artist-names, artist-links).
 *   node --max-old-space-size=8192 scripts/measure-alias-census.mjs [out.json]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = process.argv[2] ?? 'data/alias-match-census.json'
const POOL_LIMIT = 300
const UNDATED_FLOOR = 1980
const ALLOWED = new Set(['Artist name', 'Legal name'])

const normalize = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const SCRIPTS = ['Arabic', 'Cyrillic', 'Greek', 'Hebrew', 'Han', 'Hiragana', 'Katakana', 'Hangul',
  'Devanagari', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Gujarati', 'Gurmukhi', 'Sinhala',
  'Thai', 'Lao', 'Khmer', 'Myanmar', 'Georgian', 'Armenian', 'Ethiopic', 'Tibetan', 'Mongolian', 'Thaana', 'Syriac']
const SCRIPT_RE = SCRIPTS.map((script) => [script, new RegExp(`\\p{Script=${script}}`, 'u')])
const LATIN = /\p{Script=Latin}/u

function lettersOf(value) {
  return value.match(/\p{L}/gu) ?? []
}
function scriptOf(value) {
  const counts = new Map()
  for (const ch of lettersOf(value)) {
    const hit = SCRIPT_RE.find(([, re]) => re.test(ch))
    const key = hit ? hit[0] : LATIN.test(ch) ? 'Latin' : 'Other'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const name = top?.[0] ?? 'None'
  return name === 'Hiragana' || name === 'Katakana' ? 'Japanese kana' : name
}
const isLatinOnly = (value) => {
  const letters = lettersOf(value)
  return letters.length > 0 && letters.every((ch) => LATIN.test(ch))
}
const hasNoLatin = (value) => {
  const letters = lettersOf(value)
  return letters.length > 0 && !letters.some((ch) => LATIN.test(ch))
}

// ---- places ------------------------------------------------------------
const places = new Map()
const countryDir = join(ROOT, 'lib/explore/country-artists')
for (const file of readdirSync(countryDir)) {
  const stored = JSON.parse(readFileSync(join(countryDir, file), 'utf8'))
  places.set(file.replace('.json', ''), { name: stored.name, artists: stored.artists })
}
for (const file of ['state-artists.json', 'uk-nation-artists.json']) {
  const stored = JSON.parse(readFileSync(join(ROOT, 'lib/explore', file), 'utf8'))
  for (const [code, region] of Object.entries(stored.states)) {
    places.set(code, { name: code, artists: region.artists })
  }
}
const historical = JSON.parse(readFileSync(join(ROOT, 'lib/explore/historical-area-artists.json'), 'utf8'))
for (const [code, list] of Object.entries(historical.countries)) {
  const place = places.get(code)
  if (!place) continue
  const held = new Set(place.artists.map((artist) => artist.id))
  const extra = list
    .filter((artist) => !held.has(artist.mbid))
    .map((artist) => ({ id: artist.mbid, name: artist.name, cs: artist.lifeBegin ?? null, end: artist.lifeEnd ?? null, w: artist.votes ?? 0 }))
  places.set(code, { ...place, artists: [...place.artists, ...extra] })
}

// ---- pools: artist id -> Map(place -> Set(decade)) ----------------------
const reach = new Map()
const pooledName = new Map()
const bestRank = new Map()
for (const [code, place] of places) {
  const ordered = [
    ...place.artists.filter((artist) => artist.cs !== null).sort((a, b) => b.w - a.w),
    ...place.artists.filter((artist) => artist.cs === null).sort((a, b) => b.w - a.w),
  ]
  for (let year = 1900; year <= 2026; year++) {
    let taken = 0
    for (const artist of ordered) {
      if (taken >= POOL_LIMIT) break
      if (artist.cs !== null && artist.cs > year) continue
      if (artist.end !== null && artist.end < year) continue
      if (artist.cs === null && year < UNDATED_FLOOR) continue
      taken += 1
      const byPlace = reach.get(artist.id) ?? new Map()
      const decades = byPlace.get(code) ?? new Set()
      decades.add(Math.floor(year / 10) * 10)
      byPlace.set(code, decades)
      reach.set(artist.id, byPlace)
      pooledName.set(artist.id, artist.name)
      bestRank.set(artist.id, Math.min(bestRank.get(artist.id) ?? Infinity, taken))
    }
  }
}

// ---- scope: non-Latin names --------------------------------------------
const nonLatin = new Map()
let mixed = 0
for (const [id, name] of pooledName) {
  if (hasNoLatin(name)) nonLatin.set(id, name)
  else if (!isLatinOnly(name) && lettersOf(name).length > 0) mixed += 1
}

// ---- aliases from the local name index (Aug 29 snapshot) ----------------
const aliasesOf = new Map()
const namesDir = join(ROOT, 'data/mb-dump/artist-names')
const MARK = '"r":{"id":"'
for (const file of readdirSync(namesDir)) {
  for (const line of readFileSync(join(namesDir, file), 'utf8').split('\n')) {
    const at = line.indexOf(MARK)
    if (at === -1) continue
    const id = line.slice(at + MARK.length, at + MARK.length + 36)
    if (!nonLatin.has(id) || aliasesOf.has(id)) continue
    aliasesOf.set(id, JSON.parse(line).r.aliases ?? [])
  }
}

// ---- MB-linked YouTube channels ----------------------------------------
const youtube = new Set()
const linksDir = join(ROOT, 'data/mb-dump/artist-links')
for (const file of readdirSync(linksDir)) {
  for (const line of readFileSync(join(linksDir, file), 'utf8').split('\n')) {
    if (!line.startsWith('{"a":"')) continue
    const id = line.slice(6, 42)
    if (nonLatin.has(id) && line.includes('"yt":[')) youtube.add(id)
  }
}

// ---- verdicts ----------------------------------------------------------
const rows = []
for (const [id, name] of nonLatin) {
  const aliases = aliasesOf.get(id)
  const allowed = (aliases ?? []).filter((alias) => ALLOWED.has(alias.type ?? ''))
  const own = normalize(name)
  const latin = [...new Set(allowed.filter((alias) => isLatinOnly(alias.name)).map((alias) => normalize(alias.name)))]
    .filter((key) => key && key !== own)
  const otherScript = allowed.filter((alias) => !isLatinOnly(alias.name) && normalize(alias.name) !== own).length
  const untypedLatin = (aliases ?? []).filter((alias) => !ALLOWED.has(alias.type ?? '') && isLatinOnly(alias.name)).length
  const byPlace = reach.get(id)
  rows.push({
    id,
    name,
    script: scriptOf(name),
    inIndex: aliases !== undefined,
    latinAliases: latin,
    allowedTypes: [...new Set(allowed.filter((alias) => isLatinOnly(alias.name)).map((alias) => alias.type))],
    otherScriptAllowed: otherScript,
    untypedOrHintLatin: untypedLatin,
    youtube: youtube.has(id),
    bestRank: bestRank.get(id),
    places: Object.fromEntries([...byPlace].map(([code, decades]) => [code, [...decades].sort()])),
  })
}

const withAlias = rows.filter((row) => row.latinAliases.length > 0)
const byScript = (list) => {
  const counts = {}
  for (const row of list) counts[row.script] = (counts[row.script] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
}
const placesOf = (list) => new Set(list.flatMap((row) => Object.keys(row.places)))
const placeDecadesOf = (list) =>
  new Set(list.flatMap((row) => Object.entries(row.places).flatMap(([code, decades]) => decades.map((decade) => `${code}-${decade}`))))

const summary = {
  snapshot: 'MB JSON dump 2026-08-29 (local artist-names + artist-links index)',
  pooledArtists: pooledName.size,
  places: places.size,
  nonLatinNamed: rows.length,
  mixedScriptNames: mixed,
  notInIndex: rows.filter((row) => !row.inIndex).length,
  nonLatinByScript: byScript(rows),
  withAllowedLatinAlias: withAlias.length,
  withAllowedLatinAliasByScript: byScript(withAlias),
  aliasTypeLegalOnly: withAlias.filter((row) => row.allowedTypes.length === 1 && row.allowedTypes[0] === 'Legal name').length,
  withAliasNoYoutubeRel: withAlias.filter((row) => !row.youtube).length,
  withAliasAndYoutubeRel: withAlias.filter((row) => row.youtube).length,
  noAllowedLatinAliasButUntypedOrHint: rows.filter((row) => row.latinAliases.length === 0 && row.untypedOrHintLatin > 0).length,
  placesWithNonLatin: placesOf(rows).size,
  placesWithAliasArtist: placesOf(withAlias).size,
  placeDecadesWithAliasArtist: placeDecadesOf(withAlias).size,
}
writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1))
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
