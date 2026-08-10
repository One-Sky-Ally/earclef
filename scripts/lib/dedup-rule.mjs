/**
 * Dedup rule v3 (owner-approved, Aug 9, 2026) — shared by the ingest
 * pipeline and the retroactive pass. The six points:
 *
 *   1. A fuzzy match NEVER drops an artist (near-miss log only).
 *   2. A name match alone never drops: dropping needs one record-level
 *      corroborating fact — area (hierarchy-resolved), era overlap,
 *      shared release title, or a Wikidata crosswalk.
 *   3. Area contradiction triggers the shared-release-title check:
 *      titles overlap → SAME artist, foreign → excluded by ORIGIN
 *      (logged 'foreign-catalog', separate from dedup); no overlap →
 *      collision → the candidate is KEPT.
 *   4. MB aliases count only when typed Artist name / Legal name;
 *      candidate ANVs probe only when multi-token.
 *   5. Every verdict persists its evidence (mbid, basis) — decisions
 *      are made against records, immune to search-index weather.
 *   6. (Retro pass lives in apply-dedup-rule-v3.mjs.)
 *
 * Verdicts: 'new' | 'duplicate' | 'foreign-catalog' | 'crosswalk'
 *         | 'collision-kept' | 'uncorroborated-kept' | 'fuzzy-kept'
 * Only 'duplicate', 'foreign-catalog', 'crosswalk' drop a candidate.
 */

const MB_UA =
  'EarClefDedup/0.3 (https://earclef.com; fiohmemorial@gmail.com)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Comparable title keys from a Discogs display title or plain title. */
export function titleKeys(displayTitle) {
  const afterDash = displayTitle.split(/\s+[–—-]\s+/).slice(1).join(' ').trim()
  const base = afterDash || displayTitle
  const keys = new Set()
  for (const part of [base, ...base.split(/\s*\/\s*/)]) {
    const key = normalizeName(part.replace(/=\s*[^=]*$/, ''))
    if (key.length >= 3) keys.add(key)
  }
  return keys
}

async function mbJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': MB_UA },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status === 503 || res.status === 429) {
        await sleep(2500 * attempt)
        continue
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`MB ${res.status}`)
      await sleep(1200)
      return await res.json()
    } catch (error) {
      if (attempt === tries) throw error
      await sleep(2000 * attempt)
    }
  }
  return null
}

export async function fetchMbArtistRecord(mbid) {
  return mbJson(
    `https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json&inc=aliases`,
  )
}

export async function searchMbArtists(name) {
  const body = await mbJson(
    `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&limit=5&fmt=json`,
  )
  return body?.artists ?? []
}

const ALLOWED_ALIAS_TYPES = new Set(['Artist name', 'Legal name'])

/**
 * Does this MB artist's name (or a properly typed alias) EXACTLY match
 * the probe? Returns the match basis or null. Fuzzy is not consulted
 * here — it can never drop.
 */
export function exactNameHit(artist, probe) {
  const wanted = normalizeName(probe)
  if (!wanted) return null
  if (normalizeName(artist.name ?? '') === wanted) return 'name'
  for (const alias of artist.aliases ?? []) {
    if (
      ALLOWED_ALIAS_TYPES.has(alias.type ?? '') &&
      normalizeName(alias.name ?? '') === wanted
    ) {
      return 'typed-alias'
    }
  }
  return null
}

export async function artistReleaseGroupTitles(mbid) {
  const body = await mbJson(
    `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`,
  )
  const titles = new Set()
  for (const group of body?.['release-groups'] ?? []) {
    const key = normalizeName(group.title ?? '')
    if (key.length >= 3) titles.add(key)
  }
  return titles
}

const areaCache = new Map()

/** Walk the MB area hierarchy: does areaId sit inside countryName? */
export async function areaResolvesToCountry(areaId, areaName, countryName) {
  if (!areaId) return areaName === countryName ? 'match' : 'unknown'
  if (areaName === countryName) return 'match'
  const cacheKey = `${areaId}|${countryName}`
  if (areaCache.has(cacheKey)) return areaCache.get(cacheKey)
  let current = areaId
  let result = 'other'
  for (let depth = 0; depth < 4 && current; depth++) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/area/${current}?fmt=json&inc=area-rels`,
    )
    if (!body) {
      result = 'unknown'
      break
    }
    if (body.name === countryName) {
      result = 'match'
      break
    }
    const parent = (body.relations ?? []).find(
      (relation) =>
        relation.type === 'part of' && relation.direction === 'backward',
    )
    current = parent?.area?.id ?? null
  }
  areaCache.set(cacheKey, result)
  return result
}

function eraOverlaps(artist, years) {
  if (years.length === 0) return false
  const life = artist['life-span'] ?? {}
  const begin = Number((life.begin ?? '').slice(0, 4)) || null
  const end = Number((life.end ?? '').slice(0, 4)) || (life.ended ? null : 2026)
  if (!begin) return false
  return Math.min(...years) <= (end ?? 2026) && Math.max(...years) >= begin
}

/**
 * The rule. candidate: {names, years, titles:Set, dgId?}. hit: the MB
 * artist record + how it matched. Returns {verdict, basis, mbid, mbName}.
 */
export async function judgeNameHit(candidate, artist, hitBasis, countryName) {
  const rgTitles = await artistReleaseGroupTitles(artist.id)
  const shared = [...candidate.titles].some((key) => rgTitles.has(key))
  const areaStatus = await areaResolvesToCountry(
    artist.area?.id ?? artist['begin-area']?.id ?? null,
    artist.area?.name ?? artist['begin-area']?.name ?? null,
    countryName,
  )
  const evidence = {
    mbid: artist.id,
    mbName: artist.name,
    area: artist.area?.name ?? null,
    hitBasis,
  }
  if (shared) {
    return areaStatus === 'other'
      ? { verdict: 'foreign-catalog', basis: 'shared-title+foreign-area', ...evidence }
      : { verdict: 'duplicate', basis: 'shared-title', ...evidence }
  }
  // A typed-alias/name hit through an UNTYPED alias never reaches here
  // (exactNameHit filters); name-only corroboration below.
  if (areaStatus === 'match') {
    return { verdict: 'duplicate', basis: 'area', ...evidence }
  }
  if (areaStatus === 'other') {
    // Contradiction beats era: collision, not duplicate.
    return { verdict: 'collision-kept', basis: 'area-contradiction', ...evidence }
  }
  if (eraOverlaps(artist, candidate.years)) {
    return { verdict: 'duplicate', basis: 'era-overlap', ...evidence }
  }
  return { verdict: 'uncorroborated-kept', basis: 'name-only', ...evidence }
}

/** Multi-token probes only — bare forenames never decide anything. */
export function dedupProbes(names) {
  const [canonical, ...aliases] = names
  const probes = [canonical]
  for (const alias of aliases) {
    if (normalizeName(alias).split(' ').length >= 2) probes.push(alias)
  }
  return probes.slice(0, 3)
}
