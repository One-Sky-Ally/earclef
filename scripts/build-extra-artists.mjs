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
 * v3 (Aug 10, 2026, owner-approved rollout changes): country table
 * moved to lib/gap-fill-countries.mjs (76 countries, probe-verified
 * Discogs strings + live-verified MB area names); multi-string
 * countries sweep each string and merge by release id; and the
 * RECORD-LEVEL COUNTRY GUARD — a release is ingested only when its
 * own detail country field exactly equals a configured string ("rule
 * on the record, not the query": search-index token bleed like
 * Guinea/Guinea-Bissau cannot reach the dataset). Display-string
 * fallback is disabled where the country string is a token of another
 * Discogs country (noFallback) — an unattributable release is skipped
 * and counted, never guessed.
 *
 * Runs LOCALLY and commits JSON — the live site never calls Discogs,
 * so DISCOGS_TOKEN belongs in .env.local and NOT in Netlify.
 *
 * Usage: node scripts/build-extra-artists.mjs CC [CC ...]
 * Resumable: data/extra-artists-work-v2.json checkpoints every phase
 * (v1 MB-dedup verdicts are seeded in where the name key is unchanged).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  dedupDataSources,
  judgeCandidate,
  titleKeys,
} from './lib/dedup-rule.mjs'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'
import {
  artistRecord,
  plantSliceRows,
  releaseIndexAvailable,
  releasesFor,
  releasesMeta,
  videoIndexAvailable,
  videoReleaseRefsFor,
} from './lib/discogsDump.mjs'
import { getJson } from './lib/fetchJson.mjs'
import { assertNothingRemoved, mergeIntoCommitted } from './lib/gapFillMerge.mjs'
import { heldPoolIds, isHeldInPool } from './lib/originHeld.mjs'
import {
  collectWikidataRows,
  ownerRuledDecision,
  wikidataQuery,
} from './lib/gapFillWikidata.mjs'
import {
  OCCUPATION_FILTER_VERSION,
  ownerRuledClassesOf,
} from './lib/musicOccupations.mjs'
import { sameName } from './lib/normalizeName.mjs'
import { classifyProfile } from './lib/profileOrigin.mjs'

/** Born-only profile cases, held for the owner (regenerated per run). */
const PROFILE_HELD_PATH = 'data/profile-origin-held.json'
/** Per-artist decisions under the Sep 21 owner ruling (regenerated per run). */
const OWNER_RULED_PATH = 'data/occupation-owner-ruled-report.json'
/** Where the owner ruling is recorded verbatim — copied into the report. */
const OCCUPATION_LISTS_PATH = 'data/occupation-filter-lists.json'

const WORK_PATH = 'data/extra-artists-work-v2.json'
const OUT_PATH = 'lib/explore/extra-artists.json'
const REPORT_PATH = 'data/extra-artists-report.json'

const MB_UA = 'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const DG_UA = 'EarClef/0.1 +https://earclef.com'
const MB_DELAY_MS = 1100
/** Discogs authenticated ceiling is 60/min; stay under it. */
const DG_DELAY_MS = 1100
const DG_PAGE_SIZE = 50
/** 120 pages × 50 = 6,000 releases — above every approved catalog. */
const DG_MAX_PAGES = 120

/**
 * Wikidata label preference: English first (site convention), then
 * the swept countries' languages so an artist unlabelled in English
 * arrives in native script instead of being skipped as a bare QID.
 */
const LABEL_LANGS =
  'en,es,fr,pt,ar,fa,ru,uk,sq,hy,az,ro,vi,km,my,dz,ne,si,bn,mn,th,lo,uz,tg,ky,tk,kk,ms,sw,am,ti,so,ha,yo,da,kl'

/**
 * Flags (Sep 6, 2026):
 *   --source=api   force the Discogs web API even when the local dump
 *                  index exists (the dump is the default source)
 *   --replace      overwrite a country's committed list with this run's
 *                  result. WITHOUT it, a country that already has a
 *                  committed list is MERGED: every existing entry keeps
 *                  every field (presence, note, aliases, retention) and
 *                  only era/press-count widen; new artists are appended.
 *                  Replacing forgets state that later passes wrote onto
 *                  entries (standing lesson 2), so it must be asked for.
 *   ALL            every configured country
 */
const argv = process.argv.slice(2)
const FORCE_DISCOGS_API = argv.includes('--source=api')
const REPLACE = argv.includes('--replace')
const codeArgs = argv.filter((arg) => !arg.startsWith('--'))
const targets = codeArgs.includes('ALL')
  ? Object.keys(COUNTRIES)
  : codeArgs.filter((code) => COUNTRIES[code])
if (targets.length === 0) {
  console.error('Usage: node scripts/build-extra-artists.mjs CC [CC ...] | ALL  [--replace] [--source=api]')
  console.error(`Valid codes: ${Object.keys(COUNTRIES).join(' ')}`)
  process.exit(1)
}

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

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- Wikidata

/**
 * Musicians and groups tied to a country, with dates and the ID
 * crosswalk. A P434 (MusicBrainz ID) means MB already knows them —
 * those become dedup fuel, never candidates. Occupation admission is
 * the explicit list in lib/musicOccupations.mjs (occupation-filter fix,
 * Sep 2026); query and row handling live in lib/gapFillWikidata.mjs.
 * Throws after bounded retries — the caller skips the country.
 */
async function wikidataPass(qid) {
  const body = await getJson(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(wikidataQuery(qid, LABEL_LANGS))}`,
    { 'User-Agent': MB_UA, Accept: 'application/sparql-results+json' },
    { tries: 4, timeoutMs: 120_000, backoffMs: 5000 },
  )
  return collectWikidataRows(body.results.bindings)
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

/**
 * What admitted this country's Wikidata people, for the run report:
 * per-bucket counts and, per listed class, its label and how many
 * people carry it — so the classes can be read before anything ships.
 */
function occupationStats(wd, ownerRuled) {
  const classes = {}
  for (const person of wd) {
    for (const tagged of person.occupations ?? []) {
      const entry = (classes[tagged] ??= { label: person.occupationLabels?.[tagged] ?? null, people: 0 })
      entry.label ??= person.occupationLabels?.[tagged] ?? null
      entry.people++
    }
  }
  const decided = (decision) => ownerRuled.filter((entry) => entry.decision === decision).length
  return {
    filter: OCCUPATION_FILTER_VERSION,
    performer: wd.filter((person) => person.admission === 'performer').length,
    ownerRuled: { admitted: decided('admit'), held: decided('held'), leftOut: decided('out') },
    classes,
  }
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
    if (page >= DG_MAX_PAGES) {
      // Never truncate silently — a capped sweep must be visible.
      console.warn(
        `    ⚠ CAP: "${country}" has ${pages} pages, swept only ${DG_MAX_PAGES}` +
          ` (${found.length} releases) — needs year-windowing or a higher cap`,
      )
      break
    }
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
 * spelling preserved as an alias. v3 also returns the record's own
 * country field for the record-level guard. Null on fetch failure
 * (the caller falls back to display-string parsing where allowed).
 */
async function releaseCredits(releaseId) {
  try {
    const body = await getJson(
      `https://api.discogs.com/releases/${releaseId}?token=${token}`,
      { 'User-Agent': DG_UA },
    )
    const credits = (body.artists ?? []).flatMap((credit) => {
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
    return { country: body.country ?? null, credits }
  } catch {
    return null
  }
}

const stripDisambiguation = (name) => name.replace(/\s*\(\d+\)\s*$/, '').trim()

/**
 * A dump row in the shape the API search pass stored — the title is
 * rebuilt as "credits – title" (the search's display form) so
 * titleKeys() and the display-string fallback behave identically.
 */
function dumpRelease(row) {
  const names = row.artists.map((credit) =>
    credit.anv ? credit.anv : stripDisambiguation(credit.name),
  )
  return {
    title: names.length > 0 ? `${names.join(' / ')} – ${row.title}` : row.title,
    year: row.year,
    id: row.id,
    label: row.labels[0]?.name ?? null,
    style: [...row.styles, ...row.genres].slice(0, 3),
  }
}

/** Same filter releaseCredits() applied to the API record. */
function dumpCredits(row) {
  const credits = row.artists.flatMap((credit) => {
    if (!credit.id || GENERIC_CREDIT_IDS.has(credit.id)) return []
    const canonical = stripDisambiguation(credit.name)
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
  return { country: row.country, credits }
}

/** Resolve a surviving candidate to its Discogs artist page. */
async function discogsArtistId(name) {
  const body = await getJson(
    `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(name)}&per_page=5&token=${token}`,
    { 'User-Agent': DG_UA },
  )
  for (const result of body.results ?? []) {
    const title = (result.title ?? '').replace(/\s*\(\d+\)\s*$/, '')
    if (sameName(title, name)) return result.id ?? null
  }
  return null
}

// ---------------------------------------------------------- merge assembly

// ------------------------------------------------------------------- main

async function main() {
  mkdirSync('data', { recursive: true })
  const work = loadJson(WORK_PATH, { countries: {} })
  // Which MusicBrainz path the dedup takes (local dump indexes vs the
  // 1 req/s API) — logged so every run's evidence source is on record.
  console.log(`dedup sources: ${JSON.stringify(dedupDataSources())}`)
  // Owner-ruled evidence sources (Sep 21 ruling) — logged like the above.
  const videoIndex = videoIndexAvailable()
  console.log(
    `occupation filter: ${OCCUPATION_FILTER_VERSION}; owner-ruled evidence: sweep credits` +
      (videoIndex ? ' + Discogs video index' : ' only (Discogs video index unavailable)'),
  )

  // A Wikidata pass cached under an older occupation filter is stale:
  // re-running it is the fix taking effect (lesson 2 — the cache
  // outlives the code). That refresh runs in TOP-UP mode only, where
  // nobody already committed can be removed; --replace would forget
  // them, so the two are refused together.
  const staleWikidata = (state) =>
    Boolean(state?.wikidata) && state.wikidataFilter !== OCCUPATION_FILTER_VERSION
  const staleTargets = targets.filter((code) => staleWikidata(work.countries[code]))
  if (REPLACE && staleTargets.length > 0) {
    console.error(
      `--replace refused: ${staleTargets.join(' ')} would refresh a Wikidata pass cached under an older occupation filter.` +
        ' Run the refresh without --replace (top-up merge) first.',
    )
    process.exit(1)
  }

  // Countries whose Wikidata pass failed this run. They are left exactly
  // as committed and retried by the next invocation — never built from a
  // stale or missing pass.
  const skipped = []

  for (const code of targets) {
    const config = COUNTRIES[code]
    const state = (work.countries[code] ??= {})
    console.log(`\n=== ${config.name} (${code})`)

    // 1. Wikidata: canon names + the crosswalk.
    if (!state.wikidata || staleWikidata(state)) {
      console.log(
        state.wikidata
          ? `  Wikidata pass (cached under ${state.wikidataFilter ?? 'the pre-fix filter'} — refreshing)…`
          : '  Wikidata pass…',
      )
      let people
      try {
        people = await wikidataPass(config.qid)
      } catch (error) {
        console.warn(`  ⚠ SKIPPED ${code}: Wikidata pass failed (${error.message}) — rerun to retry`)
        skipped.push(code)
        continue
      }
      // Sets don't survive JSON checkpoints — store them as arrays (a
      // resumed run once crashed on {}.has; lesson 2 again: stored state
      // outlives the code that wrote it).
      state.wikidata = people.map((person) => ({
        ...person,
        citizenships: [...person.citizenships],
        occupations: [...person.occupations],
      }))
      state.wikidataFilter = OCCUPATION_FILTER_VERSION
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

    // 2. Discogs: what the crates hold. THE DUMP IS THE RECORD (Sep 6,
    // 2026): every release filed under a configured string, credits
    // included, straight from the local index — no search layer to
    // lose a fifth of them, no rate limit. Releases the stored sweep
    // never saw are unioned in; cached API credits stand (audited
    // identical to the dump) and only recordless releases take theirs
    // from the dump. The API path survives as --source=api.
    const useDump = !FORCE_DISCOGS_API && releaseIndexAvailable()
    if (useDump) {
      const edition = releasesMeta()?.source ?? 'dump'
      const stored = state.releases?.length ?? 0
      const known = new Set((state.releases ?? []).map((release) => release.id))
      const added = []
      let creditsFromDump = 0
      state.credits ??= {}
      for (const label of config.discogs) {
        for (const row of releasesFor(label)) {
          if (!known.has(row.id)) {
            known.add(row.id)
            added.push(dumpRelease(row))
          }
          if (state.credits[row.id] === undefined || state.credits[row.id] === null) {
            state.credits[row.id] = dumpCredits(row)
            creditsFromDump++
          }
        }
      }
      // PLANT SLICES: releases of a multi-state string ("USSR") that
      // name this country's plant. They enter as candidates only — the
      // origin gate below decides who ships (see gap-fill-countries).
      for (const slice of config.plantSlices ?? []) {
        let sliceAdded = 0
        const rows = plantSliceRows(slice)
        for (const row of rows) {
          if (!known.has(row.id)) {
            known.add(row.id)
            added.push({ ...dumpRelease(row), slice: slice.label })
            sliceAdded++
          }
          if (state.credits[row.id] === undefined || state.credits[row.id] === null) {
            state.credits[row.id] = dumpCredits(row)
            creditsFromDump++
          }
        }
        console.log(
          `   plant slice "${slice.label}" (${slice.country}): ${rows.length} releases name it, +${sliceAdded} new to this state`,
        )
      }
      state.releases = [...(state.releases ?? []), ...added]
      state.discogsSource = { source: 'dump', edition, addedReleases: added.length }
      console.log(
        `  Discogs (${edition}): ${state.releases.length} releases — ${stored} stored, +${added.length} never seen, ${creditsFromDump} credit records from the dump`,
      )
      writeFileSync(WORK_PATH, JSON.stringify(work))
    } else if (!state.releases) {
      console.log('  Discogs pass (api)…')
      const merged = []
      const seen = new Set()
      for (const label of config.discogs) {
        if (config.discogs.length > 1) console.log(`   string "${label}"`)
        const releases = await discogsReleases(label)
        for (const release of releases) {
          if (seen.has(release.id)) continue
          seen.add(release.id)
          merged.push(release)
        }
        await sleep(DG_DELAY_MS)
      }
      state.releases = merged
      writeFileSync(WORK_PATH, JSON.stringify(work))
    }
    console.log(`  Discogs: ${state.releases.length} releases`)

    // 2b. STRUCTURED CREDITS per release (+1 call each, resumable).
    // A null (failed fetch) retries once per invocation — a transient
    // blip must not permanently skip a release, especially where
    // noFallback means there is no display-string second chance.
    state.credits ??= {}
    const uncredited = state.releases.filter(
      (release) =>
        state.credits[release.id] === undefined ||
        state.credits[release.id] === null,
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
    const allowedCountries = new Set(config.discogs)
    const sliceByLabel = new Map(
      (config.plantSlices ?? []).map((slice) => [slice.label, slice]),
    )
    let unparsed = 0
    let fallbackReleases = 0
    let unfetchedSkipped = 0
    let countryMismatch = 0
    let noCountry = 0
    for (const release of state.releases) {
      const stored = state.credits[release.id]
      // Pre-guard checkpoints (LA/PY) stored bare credit arrays; those
      // ingests were vetted and shipped — they stand as-is.
      const legacy = Array.isArray(stored)
      const credits = legacy ? stored : stored?.credits
      if (stored === null || stored === undefined) {
        // Detail fetch failed — no record to rule on. Where the country
        // string is a token of another Discogs country, guessing from
        // the display string could attribute a foreign release: skip.
        if (config.noFallback) {
          unfetchedSkipped++
          continue
        }
        // v1 display-string fallback.
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
          titles: new Set(),
          releaseCount: 0,
        }
        entry.releaseCount++
        if (release.year) entry.years.push(release.year)
        for (const style of release.style ?? []) entry.styles.add(style)
        for (const titleKey of titleKeys(release.title)) {
          entry.titles.add(titleKey)
        }
        candidates.set(key, entry)
        continue
      }
      // A plant-slice release is admitted only under ITS country string
      // ("USSR"); the plant on the record is what carved it out.
      const slice = release.slice ? (sliceByLabel.get(release.slice) ?? null) : null
      // RECORD-LEVEL COUNTRY GUARD (rule on the record, not the query):
      // the release's own country field must exactly equal a configured
      // string. Absent never matches (standing lesson 4).
      if (!legacy) {
        const recordCountry = stored.country ?? null
        if (recordCountry === null) {
          noCountry++
          continue
        }
        const admitted = slice
          ? recordCountry === slice.country
          : allowedCountries.has(recordCountry)
        if (!admitted) {
          countryMismatch++
          continue
        }
      }
      // Provenance fix-forward (owner, Aug 26 2026): when the record's
      // own country string is an approved HISTORICAL entity (config
      // .historical registry), keep it — the sweep knew this at ingest
      // and must never throw it away again. A slice release records its
      // plant the same way ("USSR · Tashkent plant").
      const pressedAs = slice
        ? `${slice.country} · ${slice.label}`
        : !legacy && (config.historical ?? []).includes(stored?.country ?? '')
          ? stored.country
          : null
      for (const credit of credits) {
        const key = `dg|${credit.id}`
        const entry = candidates.get(key) ?? {
          name: credit.name,
          source: 'discogs',
          years: [],
          styles: new Set(),
          aliases: new Set(),
          titles: new Set(),
          discogsArtistId: credit.id,
          releaseCount: 0,
          // True until a release OUTSIDE any slice names this artist.
          sliceOnly: Boolean(slice),
        }
        entry.releaseCount++
        entry.sliceOnly = entry.sliceOnly && Boolean(slice)
        if (pressedAs) (entry.pressedAs ??= new Set()).add(pressedAs)
        if (credit.anv && normalize(credit.anv) !== normalize(credit.name)) {
          entry.aliases.add(credit.anv)
        }
        if (release.year) entry.years.push(release.year)
        for (const style of release.style ?? []) entry.styles.add(style)
        for (const titleKey of titleKeys(release.title)) {
          entry.titles.add(titleKey)
        }
        candidates.set(key, entry)
      }
    }
    state.guard = { countryMismatch, noCountry, unfetchedSkipped }
    console.log(
      `  credits resolved for ${state.releases.length - fallbackReleases}/${state.releases.length} releases` +
        ` (${fallbackReleases} on display-string fallback)`,
    )
    console.log(
      `  record guard: ${countryMismatch} country-mismatch, ${noCountry} no-country,` +
        ` ${unfetchedSkipped} unfetched-skipped`,
    )
    let foreignByOrigin = 0
    const ownerRuled = []
    for (const person of wd) {
      if (person.mbid) continue
      if (isForeignByOrigin(person, config.qid)) {
        foreignByOrigin++
        continue
      }
      // OWNER-RULED OCCUPATIONS (Sep 21, 2026): conductors, choir
      // directors, producer-only, spoken word, arrangers, beatmakers
      // enter per artist, only on id-linked evidence of a released
      // recording (lib/gapFillWikidata.mjs ownerRuledDecision). They
      // never attach to a candidate by name.
      if (person.admission === 'ownerRuled') {
        const byId = person.discogsId ? candidates.get(`dg|${person.discogsId}`) : undefined
        const ruling = ownerRuledDecision(person, {
          creditedInSweep: byId !== undefined,
          mainCreditRefs:
            person.discogsId && videoIndex ? videoReleaseRefsFor(person.discogsId) : [],
        })
        ownerRuled.push({
          code,
          wikidataId: person.wikidataId,
          name: person.name,
          classes: ownerRuledClassesOf(person.occupations),
          discogsId: person.discogsId ?? null,
          decision: ruling.decision,
          basis: ruling.basis,
          // Credited on a release this sweep ingested: that credit is its
          // own (pre-existing) path into the pool, whatever the decision.
          discogsCandidate: byId !== undefined,
        })
        if (ruling.decision !== 'admit') continue
        if (byId) {
          byId.wikidataId = person.wikidataId
          if (person.year) byId.years.push(person.year)
          continue
        }
        candidates.set(`wd|${person.wikidataId}`, {
          name: person.name,
          source: 'wikidata',
          years: person.year ? [person.year] : [],
          styles: new Set(),
          aliases: new Set(),
          titles: new Set(),
          wikidataId: person.wikidataId,
          discogsArtistId: person.discogsId,
          releaseCount: 0,
        })
        continue
      }
      // Match by Discogs id first (the reliable crosswalk), then by
      // exact normalized name against canonical names and aliases —
      // both sides present (a symbol-only label normalizes to '').
      const existing =
        (person.discogsId ? candidates.get(`dg|${person.discogsId}`) : null) ??
        [...candidates.values()].find(
          (candidate) =>
            sameName(candidate.name, person.name) ||
            [...candidate.aliases].some((alias) => sameName(alias, person.name)),
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
        titles: new Set(),
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
    state.ownerRuled = ownerRuled
    state.occupationAdmission = occupationStats(wd, ownerRuled)
    console.log(
      `  occupations: ${state.occupationAdmission.performer} performer-class; owner-ruled` +
        ` ${ownerRuled.filter((entry) => entry.decision === 'admit').length} admitted,` +
        ` ${ownerRuled.filter((entry) => entry.decision === 'held').length} held,` +
        ` ${ownerRuled.filter((entry) => entry.decision === 'out').length} left out`,
    )

    // PLANT-SLICE ORIGIN GATE. A candidate known ONLY from slice
    // releases ships only if this country's Wikidata pass claims them
    // (the loop above set wikidataId by Discogs id or exact name). A
    // Wikidata person carrying an MB id is MB-known and flows on to the
    // dedup, which records 'crosswalk'. Otherwise the PROFILE-ORIGIN
    // RULE (owner ruling, Sep 7, 2026 — scripts/lib/profileOrigin.mjs):
    // an explicit nationality claim in the Discogs profile ships
    // (basis profile-origin), a mixed claim ships with a note, a
    // birth-clause-only mention is HELD for the owner, a foreign claim
    // is not this pool's. No evidence at all → the plant alone never
    // places anyone: counted, sampled, dropped.
    if (sliceByLabel.size > 0) {
      const stats = {
        releases: state.releases.filter((release) => release.slice).length,
        candidates: 0,
        originResolved: 0,
        mbKnown: 0,
        profileClaim: 0,
        profileMixed: 0,
        profileBornOnlyHeld: 0,
        profileForeign: 0,
        originUnknown: 0,
        originUnknownSample: [],
        profileForeignSample: [],
      }
      const held = []
      const wdByDiscogs = new Map(
        wd.filter((person) => person.discogsId).map((person) => [String(person.discogsId), person]),
      )
      const wdByName = new Map(
        wd
          .map((person) => [normalize(person.name), person])
          .filter(([key]) => key !== ''),
      )
      const unknown = []
      // Walk slice-only candidates in artist-shard order so each of the
      // 256 Discogs artist shards is read once, not thrashed through a
      // small cache (was ~20 min per run, now ~1).
      const sliceOnlyEntries = [...candidates.entries()]
        .filter(([, candidate]) => candidate.sliceOnly)
        .sort(
          ([, a], [, b]) =>
            ((a.discogsArtistId ?? 0) % 256) - ((b.discogsArtistId ?? 0) % 256) ||
            (a.discogsArtistId ?? 0) - (b.discogsArtistId ?? 0),
        )
      for (const [key, candidate] of sliceOnlyEntries) {
        stats.candidates++
        if (candidate.wikidataId) {
          stats.originResolved++
          continue
        }
        const person =
          (candidate.discogsArtistId != null
            ? wdByDiscogs.get(String(candidate.discogsArtistId))
            : null) ??
          wdByName.get(normalize(candidate.name)) ??
          [...candidate.aliases].map((alias) => wdByName.get(normalize(alias))).find(Boolean)
        if (person?.mbid) {
          stats.mbKnown++
          continue
        }
        const profile = artistRecord(candidate.discogsArtistId)?.profile ?? null
        const ruling = classifyProfile(profile, code)
        if (ruling.verdict === 'claim' || ruling.verdict === 'mixed') {
          stats[ruling.verdict === 'claim' ? 'profileClaim' : 'profileMixed']++
          candidate.originBasis = 'profile-origin'
          candidate.originEvidence = ruling.excerpt
          if (ruling.verdict === 'mixed') {
            candidate.note = `profile-origin (mixed claims ${ruling.foreignClaims.join('/')}): ${ruling.excerpt}`
          }
          continue
        }
        const years = [...new Set(candidate.years)].sort((a, b) => a - b)
        if (ruling.verdict === 'born-only') {
          stats.profileBornOnlyHeld++
          held.push({
            code,
            key,
            name: candidate.name,
            discogsArtistId: candidate.discogsArtistId,
            releaseCount: candidate.releaseCount,
            years: years.length ? `${years[0]}–${years[years.length - 1]}` : null,
            foreignClaims: ruling.foreignClaims,
            // Which presence edge this case needs — born / based /
            // performed — so the held list is Artist Chapters phase 2
            // seed data, not a backlog (owner, Sep 7 2026).
            edgeNeeded: ruling.edgeNeeded ?? 'born',
            profile: ruling.excerpt,
          })
          candidates.delete(key)
          continue
        }
        if (ruling.verdict === 'foreign') {
          stats.profileForeign++
          if (stats.profileForeignSample.length < 10) {
            stats.profileForeignSample.push(`${candidate.name} → ${ruling.foreignClaims.join('/')}`)
          }
          candidates.delete(key)
          continue
        }
        stats.originUnknown++
        unknown.push(candidate)
        candidates.delete(key)
      }
      stats.originUnknownSample = unknown
        .sort((a, b) => b.releaseCount - a.releaseCount)
        .slice(0, 15)
        .map((candidate) => `${candidate.name} (${candidate.releaseCount})`)
      state.plantSlices = stats
      state.profileHeld = held.sort((a, b) => b.releaseCount - a.releaseCount)
      console.log(
        `  plant slices: ${stats.releases} releases → ${stats.candidates} slice-only candidates: ${stats.originResolved} via Wikidata, ${stats.mbKnown} MB-known, profile claim ${stats.profileClaim} + mixed ${stats.profileMixed} ship, ${stats.profileBornOnlyHeld} born-only HELD, ${stats.profileForeign} foreign, ${stats.originUnknown} unknown (not shipped)`,
      )
    }

    // 3. Dedup against MusicBrainz under RULE v3 (owner-approved,
    // Aug 9 2026 — see scripts/lib/dedup-rule.mjs): fuzzy never
    // drops; a name match drops only with record-level corroboration
    // (area hierarchy / era / shared release title / crosswalk); area
    // contradiction + shared title = same artist but FOREIGN, an
    // origin exclusion logged separately from dedup.
    state.verdicts ??= {}
    const entries = [...candidates.entries()]
    const pending = entries.filter(([key]) => state.verdicts[key] === undefined)
    console.log(`  Dedup (rule v3): ${pending.length} to judge against MusicBrainz…`)
    let done = 0
    for (const [key, candidate] of pending) {
      // A Wikidata item carrying an MB id is definitionally known.
      const wdMatch = wd.find(
        (person) => person.mbid && sameName(person.name, candidate.name),
      )
      if (wdMatch) {
        state.verdicts[key] = { verdict: 'crosswalk', mbid: wdMatch.mbid }
      } else {
        const cand = {
          names: [candidate.name, ...candidate.aliases],
          years: [...new Set(candidate.years)],
          titles: candidate.titles ?? new Set(),
        }
        // Every exact-name namesake is weighed and the best-corroborated
        // verdict wins (judgeCandidate). MB's own area name (verified
        // per country) is the country test — a display-name mismatch
        // here would turn real duplicates into collisions.
        const judged = await judgeCandidate(cand, {
          country: code,
          areaName: config.mbArea,
        })
        state.verdicts[key] = judged ?? { verdict: 'new', basis: 'no-exact-hit' }
      }
      done++
      if (done % 20 === 0) {
        writeFileSync(WORK_PATH, JSON.stringify(work))
        console.log(`    ${done}/${pending.length}`)
      }
    }
    writeFileSync(WORK_PATH, JSON.stringify(work))

    // 4. Survivors: everything rule v3 does not corroborate a drop for.
    const KEEP_VERDICTS = new Set([
      'new',
      'fuzzy-kept',
      'collision-kept',
      'uncorroborated-kept',
    ])
    const survivors = entries
      .filter(([key]) => KEEP_VERDICTS.has(state.verdicts[key]?.verdict))
      .map(([, candidate]) => candidate)
    console.log(`  ${survivors.length} kept under rule v3`)

    // 5. Resolve Discogs artist pages — only the fallback/Wikidata
    // candidates need this now; credited artists carry their id.
    state.artistIds ??= {}
    // Keyed by normalized name, so an empty key would let every
    // symbol-only name share one resolution: those are not resolved.
    const resolvedArtistId = (name) => {
      const key = normalize(name)
      return key === '' ? null : (state.artistIds[key] ?? null)
    }
    for (const survivor of survivors) {
      const key = normalize(survivor.name)
      if (
        key === '' ||
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

    // A display-string fallback candidate and a structured-credit
    // candidate can resolve to the SAME Discogs id (phase 5) — merge
    // them; same id is unambiguous identity, no judgment involved.
    // Compare as strings: Wikidata crosswalk ids arrive as strings.
    const byResolvedId = new Map()
    const mergedSurvivors = []
    for (const survivor of survivors) {
      const resolvedId =
        survivor.discogsArtistId ?? resolvedArtistId(survivor.name)
      const idKey = resolvedId != null ? String(resolvedId) : null
      const existing = idKey ? byResolvedId.get(idKey) : null
      if (existing) {
        existing.years.push(...survivor.years)
        existing.releaseCount += survivor.releaseCount
        for (const style of survivor.styles) existing.styles.add(style)
        for (const alias of survivor.aliases) existing.aliases.add(alias)
        for (const pressed of survivor.pressedAs ?? [])
          (existing.pressedAs ??= new Set()).add(pressed)
        if (survivor.name !== existing.name) existing.aliases.add(survivor.name)
        continue
      }
      if (idKey) byResolvedId.set(idKey, survivor)
      mergedSurvivors.push(survivor)
    }

    state.result = mergedSurvivors
      .map((survivor) => {
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
            survivor.discogsArtistId ?? resolvedArtistId(survivor.name),
          wikidataId: survivor.wikidataId ?? null,
          ...(aliases.length > 0 ? { aliases } : {}),
          ...(survivor.pressedAs?.size
            ? { pressedAs: [...survivor.pressedAs].sort() }
            : {}),
          // Profile-origin provenance (display-neutral) and the owner's
          // keep-with-note for mixed claims.
          ...(survivor.originBasis
            ? { originBasis: survivor.originBasis, originEvidence: survivor.originEvidence }
            : {}),
          ...(survivor.note ? { note: survivor.note } : {}),
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

  // A skipped country is left exactly as committed (and out of every
  // derived list below) until a rerun builds it from a fresh pass.
  const built = targets.filter((code) => !skipped.includes(code))
  const out = { generatedAt: new Date().toISOString().slice(0, 10), countries: {} }
  const report = {}
  // Entries a ruling moved OUT of the pool into a held file. The top-up
  // merge appends any artist the committed list lacks, so without this
  // every held artist would come straight back on the next sweep.
  const held = heldPoolIds()
  for (const code of built) {
    const state = work.countries[code]
    if (!state?.result) continue
    const heldSkipped = state.result.filter((artist) => isHeldInPool(held, code, artist)).length
    if (heldSkipped > 0) console.log(`  ${code}: ${heldSkipped} held artist(s) not re-added (data/origin-held.json, data/mb-duplicates-held.json, data/occupation-held.json)`)
    const fresh = state.result
      .filter((artist) => !isHeldInPool(held, code, artist))
      .map((artist) => {
        const attested = attestedAliases.get(String(artist.discogsArtistId))
        if (!attested) return artist
        const merged = [
          ...attested,
          ...(artist.aliases ?? []).filter((alias) => !attested.includes(alias)),
        ]
        return { ...artist, aliases: merged }
      })
    const current = existing.countries[code]
    const mergeStats = current && !REPLACE ? mergeIntoCommitted(current, fresh) : null
    if (mergeStats) assertNothingRemoved(code, current, mergeStats.list)
    out.countries[code] = mergeStats ? mergeStats.list : fresh
    const verdicts = Object.values(state.verdicts ?? {})
    const count = (name) =>
      verdicts.filter((entry) => entry.verdict === name).length
    report[code] = {
      name: COUNTRIES[code].name,
      wikidataMusicians: state.wikidata.length,
      discogsReleases: state.releases.length,
      candidates: verdicts.length,
      newArtists: state.result.length,
      dropped: {
        duplicate: count('duplicate'),
        foreignCatalog: count('foreign-catalog'),
        wikidataCrosswalk: count('crosswalk'),
      },
      recordGuard: state.guard ?? null,
      foreignByOrigin: state.foreignByOrigin ?? 0,
      ...(state.occupationAdmission ? { occupationAdmission: state.occupationAdmission } : {}),
      keptDespiteNameHit: {
        fuzzyKept: count('fuzzy-kept'),
        collisionKept: count('collision-kept'),
        uncorroboratedKept: count('uncorroborated-kept'),
      },
      dated: state.result.filter((a) => a.firstYear !== null).length,
      sample: state.result.slice(0, 8).map((a) => `${a.name}${a.firstYear ? ` (${a.firstYear})` : ''}`),
      ...(state.discogsSource ? { discogsSource: state.discogsSource } : {}),
      ...(state.plantSlices ? { plantSlices: state.plantSlices } : {}),
      ...(mergeStats
        ? {
            merge: {
              committedBefore: current.length,
              committedAfter: mergeStats.list.length,
              added: mergeStats.added,
              widened: mergeStats.widened,
              skippedNameClash: mergeStats.nameClash,
              addedSample: mergeStats.addedNames.slice(0, 10),
            },
          }
        : { merge: REPLACE ? 'replaced' : 'fresh' }),
    }
  }
  out.countries = { ...existing.countries, ...out.countries }
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  // Profile-origin HELD list: regenerated for the countries run, other
  // countries' entries carried over (lesson 2: derived, re-derived).
  const heldFile = loadJson(PROFILE_HELD_PATH, { generatedAt: null, cases: [] })
  const carried = heldFile.cases.filter((entry) => !built.includes(entry.code))
  const fresh = built.flatMap((code) => work.countries[code]?.profileHeld ?? [])
  if (fresh.length > 0 || carried.length !== heldFile.cases.length) {
    writeFileSync(
      PROFILE_HELD_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          rule: 'profile-origin (owner ruling Sep 7 2026): born-only mentions are held, never shipped on the plant alone',
          cases: [...carried, ...fresh],
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`profile-origin held list: ${fresh.length} new cases → ${PROFILE_HELD_PATH}`)
  }

  // Owner-ruled decisions (Sep 21 ruling), per artist: admitted, held
  // for the owner's ear (spoken word), or left out, each with its basis.
  // Regenerated for the countries built, others carried over.
  const ruledFile = loadJson(OWNER_RULED_PATH, { cases: [] })
  const ruledCarried = ruledFile.cases.filter((entry) => !built.includes(entry.code))
  const ruledFresh = built.flatMap((code) => work.countries[code]?.ownerRuled ?? [])
  if (ruledFresh.length > 0 || ruledCarried.length !== ruledFile.cases.length) {
    writeFileSync(
      OWNER_RULED_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          filter: OCCUPATION_FILTER_VERSION,
          ownerRuling: loadJson(OCCUPATION_LISTS_PATH, {}).ownerRuling ?? null,
          note:
            'decision governs the Wikidata entry/link only; discogsCandidate=true means the artist is ' +
            'credited on a release this sweep ingested and enters (or not) through the Discogs path and dedup as before',
          cases: [...ruledCarried, ...ruledFresh],
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`owner-ruled occupations: ${ruledFresh.length} decisions → ${OWNER_RULED_PATH}`)
  }
  console.log(`\nDone → ${OUT_PATH}`)
  console.log(JSON.stringify(report, null, 2))
  if (skipped.length > 0) {
    console.warn(
      `\n⚠ ${skipped.length} country(ies) SKIPPED — Wikidata pass failed, left as committed.` +
        ` Retry: node scripts/build-extra-artists.mjs ${skipped.join(' ')}`,
    )
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
