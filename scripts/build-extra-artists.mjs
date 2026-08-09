/**
 * GAP-FILL precompute: artists from sparse-coverage countries that
 * MusicBrainz has no record of AT ALL.
 *
 * Policy (locked in the Aug 2026 scoping session):
 *   · MusicBrainz stays CANONICAL. This never merges, reconciles, or
 *     corrects MB — it only adds artists MB is missing entirely.
 *   · On ANY possible duplicate, SKIP. Losing a real artist is the
 *     accepted cost of never printing a false duplicate.
 *   · Artists FROM a place (origin), never artists whose records were
 *     merely distributed there — the same rule the panel follows.
 *
 * Sources: Wikidata (dated canon + the MB/Discogs ID crosswalk) and
 * Discogs (regional pressings MB never catalogued). Both are link-out
 * only; nothing is passed off as MusicBrainz data.
 *
 * v2 (Aug 8, 2026, owner-approved root-cause fix): candidates come
 * from STRUCTURED release credits (/releases/{id} artists[] carries
 * {id, name, anv} per credit), not parsed display strings — joint
 * credits arrive pre-split with real artist ids, and ANV spellings
 * become aliases instead of fake artists. Display-string parsing
 * survives only as the fallback for releases whose detail fetch
 * fails. Owner-attested aliases in the committed dataset are MERGED
 * into rebuilt entries, never overwritten — they were established by
 * evidence, not scraped.
 *
 * Runs LOCALLY and commits JSON — the live site never calls Discogs,
 * so DISCOGS_TOKEN belongs in .env.local and NOT in Netlify.
 *
 * Usage: node scripts/build-extra-artists.mjs [CC ...]     (default LA PY)
 * Resumable: data/extra-artists-work-v2.json checkpoints every phase
 * (v1 MB-dedup verdicts are seeded in where the name key is unchanged).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const WORK_PATH = 'data/extra-artists-work-v2.json'
const LEGACY_WORK_PATH = 'data/extra-artists-work.json'
const OUT_PATH = 'lib/explore/extra-artists.json'
const REPORT_PATH = 'data/extra-artists-report.json'

const MB_UA = 'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const DG_UA = 'EarClef/0.1 +https://earclef.com'
const MB_DELAY_MS = 1100
/** Discogs authenticated ceiling is 60/min; stay under it. */
const DG_DELAY_MS = 1100
const DG_PAGE_SIZE = 50
const DG_MAX_PAGES = 40

/** Countries: ISO code → Wikidata QID + the Discogs country string. */
const COUNTRIES = {
  LA: { qid: 'Q819', discogs: 'Laos', name: 'Laos' },
  PY: { qid: 'Q733', discogs: 'Paraguay', name: 'Paraguay' },
}

const targets = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['LA', 'PY']
).filter((code) => COUNTRIES[code])

const token = process.env.DISCOGS_TOKEN
if (!token) {
  console.error('DISCOGS_TOKEN missing — add it to .env.local')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Comparison key: case/accent/punctuation-insensitive, script-aware
 * (v1 kept only Latin+Lao, which reduced Cyrillic/Thai names to '' —
 * and per standing lesson 4, empty must never be able to match).
 */
function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** v1's normalize, kept ONLY to read v1's checked-verdict cache. */
function legacyNormalize(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9຀-໿]+/g, ' ')
    .trim()
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function getJson(url, headers, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers })
      if (res.status === 429 || res.status === 503) {
        await sleep(3000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch (error) {
      if (attempt === tries) throw error
      await sleep(2000 * attempt)
    }
  }
  throw new Error('unreachable')
}

// ---------------------------------------------------------------- Wikidata

/**
 * Musicians and groups tied to a country, with dates and the ID
 * crosswalk. A P434 (MusicBrainz ID) means MB already knows them —
 * those become dedup fuel, never candidates.
 */
async function wikidataPass(qid) {
  // P27 is CITIZENSHIP, which is not musical origin (the Tina Turner
  // problem). Birthplace and formation location are pulled alongside
  // it so the filter below can tell a national from a resident.
  const query = `SELECT ?item ?itemLabel ?mbid ?discogs ?birth ?formed ?bornIn ?formedIn ?citizen WHERE {
  { ?item wdt:P27 wd:${qid} } UNION { ?item wdt:P495 wd:${qid} }
  { ?item wdt:P106 wd:Q639669 } UNION { ?item wdt:P106 wd:Q177220 }
  UNION { ?item wdt:P106 wd:Q36834 } UNION { ?item wdt:P106 wd:Q488205 }
  UNION { ?item wdt:P31 wd:Q215380 }
  OPTIONAL { ?item wdt:P434 ?mbid }
  OPTIONAL { ?item wdt:P1953 ?discogs }
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item wdt:P571 ?formed }
  OPTIONAL { ?item wdt:P19 ?bp . ?bp wdt:P17 ?bornIn }
  OPTIONAL { ?item wdt:P740 ?fp . ?fp wdt:P17 ?formedIn }
  OPTIONAL { ?item wdt:P27 ?citizen }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es,lo,fr". }
}`
  const body = await getJson(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
    { 'User-Agent': MB_UA, Accept: 'application/sparql-results+json' },
  )
  const byItem = new Map()
  const qidOf = (row, key) => row[key]?.value.split('/').pop() ?? null
  for (const row of body.results.bindings) {
    const id = row.item.value.split('/').pop()
    const label = row.itemLabel?.value ?? ''
    // Unlabelled items surface as their own QID — useless as a name.
    if (!label || /^Q\d+$/.test(label)) continue
    const existing = byItem.get(id)
    if (existing) {
      // Multi-valued properties arrive as extra rows; union them.
      const citizen = qidOf(row, 'citizen')
      if (citizen) existing.citizenships.add(citizen)
      existing.bornIn ??= qidOf(row, 'bornIn')
      existing.formedIn ??= qidOf(row, 'formedIn')
      continue
    }
    const birth = row.birth?.value ? Number(row.birth.value.slice(0, 4)) : null
    const formed = row.formed?.value
      ? Number(row.formed.value.slice(0, 4))
      : null
    const citizen = qidOf(row, 'citizen')
    byItem.set(id, {
      wikidataId: id,
      name: label,
      mbid: row.mbid?.value ?? null,
      discogsId: row.discogs?.value ?? null,
      // Career-start proxy, matching the MB convention used site-wide.
      year: formed ?? (birth ? birth + 15 : null),
      bornIn: qidOf(row, 'bornIn'),
      formedIn: qidOf(row, 'formedIn'),
      citizenships: new Set(citizen ? [citizen] : []),
    })
  }
  return [...byItem.values()]
}

/**
 * Residence/citizenship is not musical origin. An artist is dropped
 * only when their birth or formation country is KNOWN, differs from
 * the country being swept, AND they hold no citizenship of it — that
 * keeps naturalised and exile-born nationals (Maneco Galeano, born in
 * Mexico, is a documented Paraguayan musician) while excluding people
 * a passport alone ties to the place. No origin data = no opinion.
 */
function isForeignByOrigin(person, qid) {
  const origin = person.formedIn ?? person.bornIn
  if (!origin || origin === qid) return false
  return !person.citizenships.has(qid)
}

// ----------------------------------------------------------------- Discogs

const GENERIC_NAMES = new Set([
  'various',
  'various artists',
  'unknown artist',
  'no artist',
  'traditional',
])

/**
 * Discogs search returns display titles, not structured credits:
 * "Artist – Title" (en dash). Split on the FIRST dash, strip the
 * disambiguation suffix Discogs appends to duplicate names ("Exile
 * (21)"), and drop anything generic or multi-artist.
 */
function parseArtist(title) {
  const parts = title.split(/\s+[–—-]\s+/)
  if (parts.length < 2) return null
  const raw = parts[0].trim()
  if (!raw) return null
  // Multi-artist credits are releases, not one artist — skip them.
  if (/\s+(?:\/|,|&|feat\.?|with)\s+/i.test(raw) && raw.split(/\s+/).length > 4) {
    return null
  }
  const cleaned = raw
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\*+$/, '')
    .trim()
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return null
  if (GENERIC_NAMES.has(cleaned.toLowerCase())) return null
  return cleaned
}

/** Every release Discogs files under this country, paged. */
async function discogsReleases(country) {
  const found = []
  for (let page = 1; page <= DG_MAX_PAGES; page++) {
    const body = await getJson(
      `https://api.discogs.com/database/search?country=${encodeURIComponent(country)}&type=release&per_page=${DG_PAGE_SIZE}&page=${page}&token=${token}`,
      { 'User-Agent': DG_UA },
    )
    for (const result of body.results ?? []) {
      found.push({
        title: result.title ?? '',
        year: Number(result.year) || null,
        id: result.id,
        label: (result.label ?? [])[0] ?? null,
        style: (result.style ?? []).concat(result.genre ?? []).slice(0, 3),
      })
    }
    const pages = body.pagination?.pages ?? 1
    console.log(`    page ${page}/${pages} (${found.length} releases)`)
    if (page >= pages) break
    await sleep(DG_DELAY_MS)
  }
  return found
}

/** Discogs's placeholder credits — never artists. */
const GENERIC_CREDIT_IDS = new Set([
  194, // Various
  118760, // Unknown Artist
  355, // No Artist
])

/**
 * v2 core: structured credits for one release. artists[] carries
 * {id, name, anv} per credited artist — real ids, and the display
 * spelling preserved as an alias. Null on fetch failure (the caller
 * falls back to display-string parsing for that release).
 */
async function releaseCredits(releaseId) {
  try {
    const body = await getJson(
      `https://api.discogs.com/releases/${releaseId}?token=${token}`,
      { 'User-Agent': DG_UA },
    )
    return (body.artists ?? []).flatMap((credit) => {
      if (!credit?.id || GENERIC_CREDIT_IDS.has(credit.id)) return []
      const canonical = (credit.name ?? '')
        .replace(/\s*\(\d+\)\s*$/, '')
        .trim()
      if (
        !canonical ||
        canonical.length < 2 ||
        canonical.length > 80 ||
        GENERIC_NAMES.has(canonical.toLowerCase())
      ) {
        return []
      }
      const anv = (credit.anv ?? '').replace(/\*+\s*$/, '').trim()
      return [{ id: credit.id, name: canonical, anv: anv || null }]
    })
  } catch {
    return null
  }
}

/** Resolve a surviving candidate to its Discogs artist page. */
async function discogsArtistId(name) {
  const body = await getJson(
    `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(name)}&per_page=5&token=${token}`,
    { 'User-Agent': DG_UA },
  )
  const wanted = normalize(name)
  for (const result of body.results ?? []) {
    const title = (result.title ?? '').replace(/\s*\(\d+\)\s*$/, '')
    if (normalize(title) === wanted) return result.id ?? null
  }
  return null
}

// ------------------------------------------------------------------ Dedup

/**
 * Is this name already in MusicBrainz? CONSERVATIVE BY DESIGN: an
 * exact normalized match is a duplicate, and so is any high-scoring
 * near match — when MB might already know them, we skip.
 */
async function inMusicBrainz(name) {
  const body = await getJson(
    `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&limit=5&fmt=json`,
    { 'User-Agent': MB_UA },
  )
  const wanted = normalize(name)
  for (const artist of body.artists ?? []) {
    if (normalize(artist.name) === wanted) return 'exact'
    for (const alias of artist.aliases ?? []) {
      if (normalize(alias.name ?? '') === wanted) return 'alias'
    }
    if ((artist.score ?? 0) >= 90) {
      const theirs = normalize(artist.name)
      // Containment either way = plausibly the same act under a
      // slightly different credit. Ambiguous → skip.
      if (theirs.includes(wanted) || wanted.includes(theirs)) return 'fuzzy'
    }
  }
  return null
}

// ------------------------------------------------------------------- main

async function main() {
  mkdirSync('data', { recursive: true })
  const work = loadJson(WORK_PATH, { countries: {} })

  for (const code of targets) {
    const config = COUNTRIES[code]
    const state = (work.countries[code] ??= {})
    console.log(`\n=== ${config.name} (${code})`)

    // 1. Wikidata: canon names + the crosswalk.
    if (!state.wikidata) {
      console.log('  Wikidata pass…')
      // Sets don't survive JSON checkpoints — store citizenships as
      // arrays (a resumed run once crashed on {}.has; lesson 2 again:
      // stored state outlives the code that wrote it).
      state.wikidata = (await wikidataPass(config.qid)).map((person) => ({
        ...person,
        citizenships: [...person.citizenships],
      }))
      writeFileSync(WORK_PATH, JSON.stringify(work))
    }
    const wd = state.wikidata.map((person) => ({
      ...person,
      citizenships: new Set(
        Array.isArray(person.citizenships) ? person.citizenships : [],
      ),
    }))
    const wdWithMb = wd.filter((entry) => entry.mbid).length
    console.log(
      `  Wikidata: ${wd.length} musicians (${wdWithMb} already carry MB ids)`,
    )

    // 2. Discogs: what the crates hold.
    if (!state.releases) {
      console.log('  Discogs pass…')
      state.releases = await discogsReleases(config.discogs)
      writeFileSync(WORK_PATH, JSON.stringify(work))
    }
    console.log(`  Discogs: ${state.releases.length} releases`)

    // 2b. STRUCTURED CREDITS per release (+1 call each, resumable).
    state.credits ??= {}
    const uncredited = state.releases.filter(
      (release) => state.credits[release.id] === undefined,
    )
    if (uncredited.length > 0) {
      console.log(`  Credits pass: ${uncredited.length} release details…`)
      let fetched = 0
      for (const release of uncredited) {
        state.credits[release.id] = await releaseCredits(release.id)
        fetched++
        if (fetched % 25 === 0) {
          writeFileSync(WORK_PATH, JSON.stringify(work))
          console.log(`    ${fetched}/${uncredited.length}`)
        }
        await sleep(DG_DELAY_MS)
      }
      writeFileSync(WORK_PATH, JSON.stringify(work))
    }

    // Candidates keyed by Discogs artist id where credits resolved
    // (canonical name + ANV spellings as aliases), by normalized name
    // for the display-string fallback + Wikidata-only people.
    const candidates = new Map()
    let unparsed = 0
    let fallbackReleases = 0
    for (const release of state.releases) {
      const credits = state.credits[release.id]
      if (credits === null || credits === undefined) {
        // Detail fetch failed — v1 display-string fallback.
        fallbackReleases++
        const name = parseArtist(release.title)
        if (!name) {
          unparsed++
          continue
        }
        const key = `nm|${normalize(name)}`
        const entry = candidates.get(key) ?? {
          name,
          source: 'discogs',
          years: [],
          styles: new Set(),
          aliases: new Set(),
          releaseCount: 0,
        }
        entry.releaseCount++
        if (release.year) entry.years.push(release.year)
        for (const style of release.style ?? []) entry.styles.add(style)
        candidates.set(key, entry)
        continue
      }
      for (const credit of credits) {
        const key = `dg|${credit.id}`
        const entry = candidates.get(key) ?? {
          name: credit.name,
          source: 'discogs',
          years: [],
          styles: new Set(),
          aliases: new Set(),
          discogsArtistId: credit.id,
          releaseCount: 0,
        }
        entry.releaseCount++
        if (credit.anv && normalize(credit.anv) !== normalize(credit.name)) {
          entry.aliases.add(credit.anv)
        }
        if (release.year) entry.years.push(release.year)
        for (const style of release.style ?? []) entry.styles.add(style)
        candidates.set(key, entry)
      }
    }
    console.log(
      `  credits resolved for ${state.releases.length - fallbackReleases}/${state.releases.length} releases` +
        ` (${fallbackReleases} on display-string fallback)`,
    )
    let foreignByOrigin = 0
    for (const person of wd) {
      if (person.mbid) continue
      if (isForeignByOrigin(person, config.qid)) {
        foreignByOrigin++
        continue
      }
      // Match by Discogs id first (the reliable crosswalk), then by
      // exact normalized name against canonical names and aliases.
      const wanted = normalize(person.name)
      const existing =
        (person.discogsId ? candidates.get(`dg|${person.discogsId}`) : null) ??
        [...candidates.values()].find(
          (candidate) =>
            normalize(candidate.name) === wanted ||
            [...candidate.aliases].some(
              (alias) => normalize(alias) === wanted,
            ),
        )
      if (existing) {
        existing.wikidataId = person.wikidataId
        if (person.year) existing.years.push(person.year)
        existing.discogsArtistId ??= person.discogsId ?? undefined
        continue
      }
      candidates.set(`wd|${person.wikidataId}`, {
        name: person.name,
        source: 'wikidata',
        years: person.year ? [person.year] : [],
        styles: new Set(),
        aliases: new Set(),
        wikidataId: person.wikidataId,
        discogsArtistId: person.discogsId ?? null,
        releaseCount: 0,
      })
    }
    console.log(
      `  ${candidates.size} candidate names (${unparsed} titles unparseable,` +
        ` ${foreignByOrigin} dropped as foreign by origin)`,
    )
    state.foreignByOrigin = foreignByOrigin

    // 3. Dedup against MusicBrainz — the expensive, careful pass.
    // Checked per candidate KEY; the canonical name AND up to two ANV
    // aliases are each verified (an alias known to MB = skip). v1's
    // verdicts seed the cache where the name is unchanged.
    state.checked ??= {}
    const legacy = loadJson(LEGACY_WORK_PATH, { countries: {} })
    const legacyChecked = legacy.countries?.[code]?.checked ?? {}
    const entries = [...candidates.entries()]
    const pending = entries.filter(([key]) => state.checked[key] === undefined)
    console.log(`  Dedup: ${pending.length} to check against MusicBrainz…`)
    let done = 0
    for (const [key, candidate] of pending) {
      const wanted = normalize(candidate.name)
      // A Wikidata item carrying an MB id is definitionally known.
      const wdMatch = wd.find(
        (person) => normalize(person.name) === wanted && person.mbid,
      )
      if (wdMatch) {
        state.checked[key] = 'crosswalk'
      } else {
        const namesToCheck = [candidate.name, ...candidate.aliases].slice(0, 3)
        // v1 skip-verdicts stand; v1 'new' still needs the ANV alias
        // spellings checked (v1 never saw them); v1 'crosswalk' was
        // country-scoped, so everything is rechecked.
        const legacyVerdict =
          legacyChecked[legacyNormalize(candidate.name)] ?? null
        let verdict = legacyVerdict === 'crosswalk' ? null : legacyVerdict
        const toCheck =
          verdict === null
            ? namesToCheck
            : verdict === 'new'
              ? namesToCheck.slice(1)
              : []
        for (const name of toCheck) {
          const hit = await inMusicBrainz(name)
          await sleep(MB_DELAY_MS)
          if (hit) {
            verdict = hit
            break
          }
        }
        state.checked[key] = verdict ?? 'new'
      }
      done++
      if (done % 20 === 0) {
        writeFileSync(WORK_PATH, JSON.stringify(work))
        console.log(`    ${done}/${pending.length}`)
      }
    }
    writeFileSync(WORK_PATH, JSON.stringify(work))

    // 4. Survivors: genuinely new to MusicBrainz.
    const survivors = entries
      .filter(([key]) => state.checked[key] === 'new')
      .map(([, candidate]) => candidate)
    console.log(`  ${survivors.length} new to MusicBrainz`)

    // 5. Resolve Discogs artist pages — only the fallback/Wikidata
    // candidates need this now; credited artists carry their id.
    state.artistIds ??= {}
    for (const survivor of survivors) {
      const key = normalize(survivor.name)
      if (
        survivor.discogsArtistId != null ||
        state.artistIds[key] !== undefined
      ) {
        continue
      }
      try {
        state.artistIds[key] = await discogsArtistId(survivor.name)
      } catch {
        state.artistIds[key] = null
      }
      await sleep(DG_DELAY_MS)
    }
    writeFileSync(WORK_PATH, JSON.stringify(work))

    state.result = survivors
      .map((survivor) => {
        const key = normalize(survivor.name)
        const years = [...new Set(survivor.years)].sort((a, b) => a - b)
        const aliases = [...survivor.aliases].slice(0, 6)
        return {
          name: survivor.name,
          source: survivor.source,
          firstYear: years[0] ?? null,
          lastYear: years[years.length - 1] ?? null,
          styles: [...survivor.styles].slice(0, 3),
          releaseCount: survivor.releaseCount,
          discogsArtistId:
            survivor.discogsArtistId ?? state.artistIds[key] ?? null,
          wikidataId: survivor.wikidataId ?? null,
          ...(aliases.length > 0 ? { aliases } : {}),
        }
      })
      // Documented years first, then the most-pressed.
      .sort(
        (a, b) =>
          (a.firstYear === null ? 1 : 0) - (b.firstYear === null ? 1 : 0) ||
          b.releaseCount - a.releaseCount ||
          a.name.localeCompare(b.name),
      )
    writeFileSync(WORK_PATH, JSON.stringify(work))
  }

  // 6. Commit the dataset + a coverage report. OWNER-ATTESTED aliases
  // in the currently committed dataset were established by evidence
  // (K. Viseth's three spellings, ສົມຟອງ's Discogs variations) and
  // MUST survive a rebuild: merge them in first, scraped ANVs after.
  const existing = loadJson(OUT_PATH, { countries: {} })
  const attestedAliases = new Map()
  for (const list of Object.values(existing.countries)) {
    for (const artist of list) {
      if (artist.aliases?.length && artist.discogsArtistId != null) {
        attestedAliases.set(String(artist.discogsArtistId), artist.aliases)
      }
    }
  }

  const out = { generatedAt: new Date().toISOString().slice(0, 10), countries: {} }
  const report = {}
  for (const code of targets) {
    const state = work.countries[code]
    if (!state?.result) continue
    out.countries[code] = state.result.map((artist) => {
      const attested = attestedAliases.get(String(artist.discogsArtistId))
      if (!attested) return artist
      const merged = [
        ...attested,
        ...(artist.aliases ?? []).filter((alias) => !attested.includes(alias)),
      ]
      return { ...artist, aliases: merged }
    })
    const skips = Object.values(state.checked ?? {})
    report[code] = {
      name: COUNTRIES[code].name,
      wikidataMusicians: state.wikidata.length,
      discogsReleases: state.releases.length,
      candidates: skips.length,
      newArtists: state.result.length,
      skipped: {
        exactNameInMb: skips.filter((v) => v === 'exact').length,
        aliasInMb: skips.filter((v) => v === 'alias').length,
        fuzzyAmbiguous: skips.filter((v) => v === 'fuzzy').length,
        wikidataCrosswalk: skips.filter((v) => v === 'crosswalk').length,
      },
      dated: state.result.filter((a) => a.firstYear !== null).length,
      sample: state.result.slice(0, 8).map((a) => `${a.name}${a.firstYear ? ` (${a.firstYear})` : ''}`),
    }
  }
  out.countries = { ...existing.countries, ...out.countries }
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`\nDone → ${OUT_PATH}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
