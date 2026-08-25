/**
 * Origin-evidence gathering for one MusicBrainz artist id.
 *
 * The ONLY origin signals accepted are the ones the Aug-11 tree already
 * ratified: Wikidata birth/formation/origin/citizenship, and MB's
 * begin-area walked up "part of" to a Country area. MB's `area` is
 * NEVER read as origin — it is residence (the Naghma ruling), and the
 * whole point of this pass is that ID-proof strengthens IDENTITY, not
 * the meaning of an area field.
 */
import { mbJson, wdJson, wikidataQidFrom } from './held-rerun-io.mjs'

const MUSICAL_PROFESSIONS = new Set([
  'Q639669', 'Q177220', 'Q36834', 'Q488205', 'Q855091', 'Q2252262',
  'Q753110', 'Q158852', 'Q183945', 'Q128124', 'Q1259917', 'Q806349',
])

/** Walk an MB area up "part of" until a Country-type area; its name. */
export async function areaToCountry(areaId, cache) {
  if (!areaId) return null
  if (cache.has(areaId)) return cache.get(areaId)
  let current = areaId
  let result = null
  for (let depth = 0; depth < 5 && current; depth++) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/area/${current}?fmt=json&inc=area-rels`,
    )
    if (!body) break
    if (body.type === 'Country') {
      result = { name: body.name, code: body['iso-3166-1-codes']?.[0] ?? null }
      break
    }
    const parent = (body.relations ?? []).find(
      (relation) => relation.type === 'part of' && relation.direction === 'backward',
    )
    current = parent?.area?.id ?? null
  }
  cache.set(areaId, result)
  return result
}

async function wikidataOrigin(qid) {
  const query = `SELECT ?desc ?born ?formed ?origin ?citizen ?prof WHERE {
  OPTIONAL { wd:${qid} schema:description ?desc . FILTER(LANG(?desc)='en') }
  OPTIONAL { wd:${qid} wdt:P19 ?bp . ?bp wdt:P17 ?born }
  OPTIONAL { wd:${qid} wdt:P740 ?fp . ?fp wdt:P17 ?formed }
  OPTIONAL { wd:${qid} wdt:P495 ?origin }
  OPTIONAL { wd:${qid} wdt:P27 ?citizen }
  OPTIONAL { wd:${qid} wdt:P106 ?prof }
}`
  const body = await wdJson(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
  )
  if (!body) return null
  const qidOf = (row, key) => row[key]?.value.split('/').pop() ?? null
  const citizenships = new Set()
  const professions = new Set()
  let description = null
  let born = null
  let formed = null
  let origin = null
  for (const row of body.results.bindings) {
    description ??= row.desc?.value ?? null
    born ??= qidOf(row, 'born')
    formed ??= qidOf(row, 'formed')
    origin ??= qidOf(row, 'origin')
    const citizen = qidOf(row, 'citizen')
    if (citizen) citizenships.add(citizen)
    const profession = qidOf(row, 'prof')
    if (profession) professions.add(profession)
  }
  return {
    qid,
    description,
    born,
    formed,
    origin,
    citizenships: [...citizenships],
    professions: [...professions],
    musician: [...professions].some((profession) => MUSICAL_PROFESSIONS.has(profession)),
  }
}

/**
 * Full evidence bundle for one MBID: the artist's own Discogs links
 * (the reverse-URL check), life-span, begin-area resolved to a country,
 * and Wikidata origin. Throws on transport failure so the caller can
 * retry — a swallowed error would become a fabricated absence.
 */
export async function gatherArtistEvidence(mbid, areaCache) {
  const artist = await mbJson(
    `https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json&inc=url-rels`,
    'relations',
  )
  if (!artist) return { missing: true }
  const beginArea = await areaToCountry(artist['begin-area']?.id ?? null, areaCache)
  const area = await areaToCountry(artist.area?.id ?? null, areaCache)
  const qid = wikidataQidFrom(artist.relations)
  const wd = qid ? await wikidataOrigin(qid) : null
  return {
    missing: false,
    name: artist.name,
    type: artist.type ?? null,
    disambiguation: artist.disambiguation ?? '',
    areaName: artist.area?.name ?? null,
    areaCountry: area?.code ?? null,
    areaCountryName: area?.name ?? null,
    beginAreaName: artist['begin-area']?.name ?? null,
    beginCountry: beginArea?.name ?? null,
    beginCountryCode: beginArea?.code ?? null,
    life: artist['life-span'] ?? null,
    relations: artist.relations ?? [],
    wd,
  }
}

export { MUSICAL_PROFESSIONS }
