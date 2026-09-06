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
 *
 * DATA SOURCES (owner go, Sep 6, 2026 — plumbing only, the six points
 * above are untouched): each MusicBrainz lookup the rule makes has a
 * LOCAL path read from the CC0 JSON dumps under data/mb-dump, used
 * automatically when the index exists and falling back to the web
 * service otherwise (EARCLEF_MB_SOURCE=api forces the API).
 *   candidates      artist-names index   ← was Lucene search, limit 5
 *   release groups  rg-by-artist index   ← was one call, limit 100
 *   area walk       area-parents index   ← was one call per hop
 * Deliberate differences, all in the direction of MORE evidence: every
 * exact-name artist is a candidate (not the search's top five), every
 * release group counts (not the first 100), and the area walk climbs
 * the whole chain (not four hops). dedupDataSources() reports which
 * path is live so every run logs it.
 */
import { normalizeName } from './normalizeName.mjs'
import { artistsNamed, nameIndexAvailable } from './mbNameIndex.mjs'
import { areaChain, areaIndexAvailable } from './mbAreaIndex.mjs'
import { dumpIndexAvailable, releaseGroupsFor } from './mbDumpIndex.mjs'

export { normalizeName }

const MB_UA =
  'EarClefDedup/0.3 (https://earclef.com; fiohmemorial@gmail.com)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const FORCE_API = process.env.EARCLEF_MB_SOURCE === 'api'

/** Which path each lookup takes right now — log this at run start. */
export function dedupDataSources() {
  return {
    candidates: !FORCE_API && nameIndexAvailable() ? 'local' : 'api',
    releaseGroups: !FORCE_API && dumpIndexAvailable() ? 'local' : 'api',
    areas: !FORCE_API && areaIndexAvailable() ? 'local' : 'api',
  }
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

/**
 * Candidate MB artists for a probe. Local: every artist whose name or
 * typed alias equals the probe, with the swept country's own artists
 * first (`country` is the ISO code, `areaName` MB's country-area name)
 * so a same-name pair resolves to the local one when one exists; the
 * API path returns the search's five, as before, and ignores opts.
 */
export async function searchMbArtists(name, opts = {}) {
  if (!FORCE_API && nameIndexAvailable()) {
    const wantedCountry = opts.country ?? null
    const wantedArea = opts.areaName ?? null
    const local = (artist) =>
      (wantedCountry && artist.country === wantedCountry) ||
      (wantedArea &&
        (artist.area?.name === wantedArea ||
          artist['begin-area']?.name === wantedArea))
        ? 0
        : 1
    // Largest catalogs next: the namesake most likely to carry a shared
    // title or the large-catalog policy must never fall past the cap.
    const catalog = new Map()
    const size = (artist) => {
      if (!catalog.has(artist.id)) {
        catalog.set(
          artist.id,
          dumpIndexAvailable() ? releaseGroupsFor(artist.id).length : 0,
        )
      }
      return catalog.get(artist.id)
    }
    return [...artistsNamed(name)].sort(
      (a, b) =>
        local(a) - local(b) || size(b) - size(a) || a.id.localeCompare(b.id),
    )
  }
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
  const groups =
    !FORCE_API && dumpIndexAvailable()
      ? releaseGroupsFor(mbid)
      : (
          await mbJson(
            `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`,
          )
        )?.['release-groups'] ?? []
  const titles = new Set()
  for (const group of groups) {
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
  if (!FORCE_API && areaIndexAvailable()) {
    // Same walk, off the dump: an id the index does not know is
    // 'unknown' (as a failed fetch was), never a match.
    const chain = areaChain(areaId)
    const local =
      chain.length === 0
        ? 'unknown'
        : chain.some((area) => area.name === countryName)
          ? 'match'
          : 'other'
    areaCache.set(cacheKey, local)
    return local
  }
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
    // RATIFIED POLICY (Aug 9, 2026): a large-catalog MB artist whose
    // FULL name (or typed alias) equals the candidate's canonical name
    // is presumed the referent even without title overlap — famous
    // compilations evade the shared-title check (D'Arienzo class).
    // Partial-ANV hits keep collision status (Víctor Hugo class).
    const fullNameEquality =
      normalizeName(artist.name ?? '') === normalizeName(candidate.names[0]) ||
      hitBasis === 'typed-alias'
    // KNOWN COST, kept deliberately (Sep 6, 2026 audit): with every
    // namesake judged this fires on one-word names too — a Gulf singer
    // "Manal" is excluded because the Argentine band shares the word.
    // A token-count gate was tried and reverted: it also readmitted
    // Madness, Chicago, DeBarge and Exodus to local pools, the
    // famous-artist pollution this policy exists to stop. Mononym
    // false exclusions are surfaced by scripts/audit-dedup-local.mjs
    // for the owner rather than traded for pollution.
    if (fullNameEquality && rgTitles.size >= 12) {
      return {
        verdict: 'foreign-catalog',
        basis: 'large-catalog-full-name',
        ...evidence,
      }
    }
    // Contradiction beats era: collision, not duplicate.
    return { verdict: 'collision-kept', basis: 'area-contradiction', ...evidence }
  }
  if (eraOverlaps(artist, candidate.years)) {
    return { verdict: 'duplicate', basis: 'era-overlap', ...evidence }
  }
  return { verdict: 'uncorroborated-kept', basis: 'name-only', ...evidence }
}

/**
 * Evidence strength of a verdict's basis — used to choose among
 * several exact-name MB artists (namesakes). Record-level facts first:
 * a shared release title identifies the referent of THESE pressings;
 * a hierarchy-resolved area match next; then the ratified
 * large-catalog policy; era overlap; and only then the two "kept"
 * bases, which carry no corroboration at all.
 */
const BASIS_RANK = {
  'shared-title': 0,
  'shared-title+foreign-area': 0,
  area: 1,
  'large-catalog-full-name': 2,
  'era-overlap': 3,
  'area-contradiction': 4,
  'name-only': 5,
}
/**
 * Generic names ("Fire", "Franco") can have dozens of namesakes; each
 * local judgment is a shard lookup, so the cap is generous. The API
 * path never sees more than the search's five anyway.
 */
const MAX_NAMESAKES_JUDGED = 64

/**
 * Judge one candidate against MusicBrainz: every probe, EVERY
 * exact-name artist (up to MAX_NAMESAKES_JUDGED, swept country first),
 * and the verdict with the strongest basis wins. Returns null when no
 * probe has an exact hit — the caller records 'new'.
 *
 * SELECTION POLICY (Sep 6, 2026): the API-era code judged the first
 * exact hit among the search's five results, which for namesake-heavy
 * names was arbitrary — the fidelity audit showed the same candidate
 * flipping between 'foreign-catalog' (the famous namesake judged) and
 * 'uncorroborated-kept' (a minor one judged) purely on ordering.
 * Judging all and keeping the best-corroborated verdict is the
 * evidence-first reading of rule point 2; `namesakes` on the verdict
 * records how many were weighed, so the choice stays auditable.
 */
export async function judgeCandidate(candidate, opts, probes = dedupProbes(candidate.names)) {
  const countryName = opts.areaName
  let best = null
  for (const probe of probes) {
    const artists = await searchMbArtists(probe, opts)
    const hits = artists
      .map((artist) => ({ artist, basis: exactNameHit(artist, probe) }))
      .filter((entry) => entry.basis)
      .slice(0, MAX_NAMESAKES_JUDGED)
    for (const hit of hits) {
      const judged = await judgeNameHit(candidate, hit.artist, hit.basis, countryName)
      judged.namesakes = hits.length
      const rank = BASIS_RANK[judged.basis] ?? 9
      if (!best || rank < best.rank) best = { rank, judged }
      if (rank === 0) break
    }
    if (best) break
  }
  return best?.judged ?? null
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
