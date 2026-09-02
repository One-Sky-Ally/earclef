/**
 * STAGE 2 of the era re-dating work (owner-approved Aug 31, 2026:
 * "Run everything. No pre-filtering — the arbitration rule already
 * protects us, since nothing moves without evidence of an older
 * original.").
 *
 * THIS SCRIPT GATHERS EVIDENCE. IT RULES ON NOTHING. Stage 3 arbitrates
 * and the owner rules the ambiguous class. Nothing here writes a
 * corrected date, and no music moves, is hidden, or is deleted.
 *
 * IDENTITY COMES IN TIERS, AND EVERY PIECE OF EVIDENCE CARRIES ITS TIER.
 *
 * Discogs is a different ID space, and matching artists across it by
 * NAME is exactly what produced the 3,907 quarantined gap-fill links
 * (standing lesson 3). So the PRIMARY crosswalk is MusicBrainz's own
 * `discogs` URL relation, captured locally by build-mb-artist-index.mjs
 * — id-level, name-free, the method the gap-fill crosswalk audit used.
 *
 * BUT ID-ONLY WOULD HAVE FAILED THE CASE THAT STARTED THIS WORK.
 * Donato Racciatti — the owner's reported Uruguay 1996 bug — carries NO
 * Discogs relation in MusicBrainz, only a Wikidata link. An id-only
 * sweep would have skipped him, and "Tu corazón" would never have been
 * re-dated. Crosswalk coverage is thinnest on exactly the vintage,
 * non-Anglo catalogue this site exists to surface, so id-only would
 * have failed hardest where it matters most.
 *
 * Identity tiers, strongest first — every match records its tier:
 *   'id-crosswalk'   MB's own discogs relation. Strongest; no name
 *                    matching anywhere.
 *   'wikidata-hop'   MB's wikidata relation → the item's P1953 (Discogs
 *                    artist id). STILL pure IDs end to end — and the
 *                    item's P434 (MB id) is round-trip checked when
 *                    present: a P434 naming a DIFFERENT artist rejects
 *                    the hop outright. This tier is what rescues the
 *                    founding case: Racciatti's Q10268281 carries
 *                    P434 = his exact MBID and P1953 = 2364880.
 *   'name-unique'    Discogs holds EXACTLY ONE artist whose normalised
 *                    name equals this one. Ambiguity is not identity —
 *                    two or more matches records `ambiguous-name` and
 *                    yields nothing, the same rule discogsIdFor applies
 *                    to multiple MB relations.
 * On top of the tier, EVERY match must clear the same evidence bar: an
 * exact normalised title match, dated EARLIER than MusicBrainz, by that
 * one artist. Supporting facts (label, format, country, whether the
 * year falls inside the artist's documented activity window) ride along
 * for Stage 3 rather than being silently folded into a verdict here.
 *
 * The tier is recorded so the owner can rule on whether 'name-unique'
 * evidence is admissible at all — and so that ruling can be applied
 * later without re-running the sweep.
 *
 * WHAT COUNTS AS EVIDENCE, gathered per candidate:
 *   titleMatch — a Discogs release by the SAME (id-matched) artist whose
 *     normalised title equals the candidate's, dated EARLIER than
 *     MusicBrainz's date. This is the strong, per-record evidence that
 *     an older original exists. Discogs `master` entries are preferred
 *     where present: a master's year IS the first-release year.
 *   artistContext — the shape of that artist's whole Discogs catalogue
 *     (earliest year, latest year, per-decade counts). NOT evidence for
 *     any single record, and never used here to move one. It is carried
 *     so Stage 3 can put a generically-titled compilation ("20 Grandes
 *     Éxitos") in front of the owner with the facts attached, rather
 *     than either guessing or discarding the case silently.
 *
 * A CANDIDATE WITH NO TITLE MATCH GETS NOTHING AND STAYS PUT. That is
 * the owner's ruling working as intended, not a gap in this script.
 *
 * Rate limit: Discogs authenticated is 60 requests/minute. Paced at
 * 1050ms with Retry-After-aware backoff. Resumable and monotonic like
 * every other sweep here — a re-run only adds.
 *
 * Usage:
 *   node scripts/build-rg-dating-evidence.mjs                # all
 *   node scripts/build-rg-dating-evidence.mjs --only UY
 *   node scripts/build-rg-dating-evidence.mjs --limit 20     # smoke
 *   node scripts/build-rg-dating-evidence.mjs --minutes 420  # time cap
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  discogsIdFor,
  artistLinksAvailable,
  wikidataQidsFor,
} from './lib/mbArtistLinks.mjs'

const SWEEP_DIR = 'data/rg-dating-sweep'
const OUT_DIR = 'data/rg-dating-evidence'
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
/** 60 req/min authenticated; 1050ms leaves headroom under the ceiling. */
const DELAY_MS = 1050
/** Release pages (100 each) per artist before we admit truncation. */
const MAX_PAGES = 3
const PAGE_SIZE = 100
const MAX_RETRIES = 4

const onlyArg = process.argv.indexOf('--only')
const onlyCodes =
  onlyArg !== -1
    ? (process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean)
    : null
const limitArg = process.argv.indexOf('--limit')
const ARTIST_LIMIT =
  limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity
const minutesArg = process.argv.indexOf('--minutes')
/**
 * A DEADLINE IS A CAP, NOT A DURATION — the loop exits early when the
 * work runs out (the gap-fill crosswalk lesson: too short a cap only
 * forces another launch).
 */
const DEADLINE_MS =
  minutesArg !== -1 ? Number(process.argv[minutesArg + 1]) * 60_000 : Infinity
const startedAt = Date.now()

function discogsToken() {
  if (process.env.DISCOGS_TOKEN) return process.env.DISCOGS_TOKEN
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DISCOGS_TOKEN='))
  return line ? line.slice('DISCOGS_TOKEN='.length).trim() : null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Title comparison key. Diacritics folded and punctuation dropped so
 * "Tu Corazón" and "Tu Corazon" are one title; everything else left
 * alone. Deliberately NOT a fuzzy match — a loose key here would
 * re-import the very identity problem the id-level crosswalk removes.
 */
const titleKey = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Every whole-title key a Discogs release can legitimately answer to.
 *
 * Pre-LP records are catalogued by BOTH SIDES — Racciatti's original is
 * "Sin Estrellas / Tu Corazon", and "Tu Corazón / Igual Que Dios" is
 * another pressing of the same song. Matching the full string alone
 * misses every single of the era this work exists to fix, so each
 * slash-separated side is also a key.
 *
 * This is still EXACT matching on a complete title unit — a side is a
 * whole title, not a fragment. It is deliberately not substring
 * containment, which would match "Tu Corazon" inside "Tu Corazon Y El
 * Mio" and re-import the problem standing lesson 7 warns about.
 */
function titleKeys(value) {
  const whole = titleKey(value)
  const keys = new Set()
  if (whole) keys.add(whole)
  for (const side of (value ?? '').split('/')) {
    const key = titleKey(side)
    // A one-word side is too weak to identify a work on its own.
    if (key && key.includes(' ')) keys.add(key)
  }
  return [...keys]
}

class RateLimited extends Error {}

/**
 * One gate for the whole sweep: wait only as long as is actually needed
 * since the LAST request, rather than sleeping after every call.
 *
 * The first version slept a fixed DELAY_MS at each call site, which
 * stacked — an artist needing a name check, a releases page and a
 * search paid four sleeps for three requests and ran at 4.8s instead of
 * ~3.2s. Over 15,722 artists that difference is eight hours of nothing
 * happening. Pacing belongs in one place, next to the request it paces.
 */
let lastRequestAt = 0
async function paced() {
  const wait = lastRequestAt + DELAY_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

/**
 * Wikidata is a separate host with its own (generous) limits — pacing
 * it through the Discogs gate would slow both for nothing. 250ms is
 * polite for entity fetches; only non-dg-linked artists ever hit it.
 */
let lastWikidataAt = 0
async function wikidataPaced() {
  const wait = lastWikidataAt + 250 - Date.now()
  if (wait > 0) await sleep(wait)
  lastWikidataAt = Date.now()
}

/**
 * The Discogs artist id reachable through a Wikidata item, or null.
 *
 * P434 ROUND-TRIP: when the item names a MusicBrainz artist, it must be
 * THIS artist — a mismatch means MB's wikidata relation and the item's
 * MB claim disagree about who this is, and identity in doubt is
 * identity refused. An absent P434 does not reject (absence is not a
 * mismatch), but it is recorded so Stage 3 can weigh the difference.
 * Exactly one P1953 is required — plural Discogs ids on one item is
 * ambiguity, refused like every other ambiguity in this pipeline.
 */
async function wikidataDiscogsId(qid, mbid) {
  await wikidataPaced()
  const res = await fetch(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) return null
  const body = await res.json()
  const claims = body.entities?.[qid]?.claims ?? {}
  const values = (prop) =>
    (claims[prop] ?? [])
      .map((claim) => claim.mainsnak?.datavalue?.value)
      .filter((value) => typeof value === 'string')
  const mbIds = values('P434')
  if (mbIds.length > 0 && !mbIds.includes(mbid)) return null
  const discogsIds = values('P1953')
  if (discogsIds.length !== 1) return null
  return { discogsId: discogsIds[0], p434Confirmed: mbIds.includes(mbid) }
}

async function discogsJson(url, token) {
  await paced()
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Authorization: `Discogs token=${token}`,
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 60
        await sleep(retryAfter * 1000)
        continue
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      await sleep(2000 * attempt)
    }
  }
  throw new RateLimited('exhausted retries')
}

/**
 * Discogs artists whose name matches EXACTLY after normalisation.
 * Returns every match, because the count is the point: one is an
 * identity, two or more is an ambiguity that must not be resolved by
 * guessing (the John Mayer rule — a name proves someone is *an* artist
 * called this, never *this* artist).
 */
async function discogsArtistsByName(name, token) {
  const body = await discogsJson(
    `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(name)}&per_page=${PAGE_SIZE}`,
    token,
  )
  const wanted = titleKey(name)
  if (!wanted) return []
  return (body?.results ?? [])
    .filter((result) => titleKey(result.title) === wanted)
    .map((result) => String(result.id))
}

/** Every Discogs release credited to this artist id, earliest first. */
async function discogsReleases(discogsId, token) {
  const releases = []
  let truncated = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await discogsJson(
      `https://api.discogs.com/artists/${discogsId}/releases?per_page=${PAGE_SIZE}&page=${page}&sort=year&sort_order=asc`,
      token,
    )
    if (!body) break
    for (const item of body.releases ?? []) {
      const year = Number(item.year)
      releases.push({
        title: item.title ?? '',
        year: Number.isFinite(year) && year > 1000 ? year : null,
        type: item.type ?? null,
        role: item.role ?? null,
        label: item.label ?? null,
        format: item.format ?? null,
        id: item.id ?? null,
      })
    }
    const pages = body.pagination?.pages ?? 1
    if (page >= pages) break
    if (page === MAX_PAGES && pages > MAX_PAGES) truncated = true
  }
  return { releases, truncated }
}

/**
 * Releases found by searching the artist's NAME rather than walking one
 * Discogs artist id.
 *
 * NEEDED BECAUSE ONE ARTIST IS OFTEN SEVERAL DISCOGS ENTITIES. Discogs
 * files Racciatti's original 1964 Sondor single under "Donato Racciatti
 * Y Su Orquesta Típica", a different artist entity from the plain
 * "Donato Racciatti" (id 2364880) that MusicBrainz-style lookup lands
 * on — so the id path alone never sees it. Orchestra and ensemble
 * credit variants are the norm for exactly the pre-LP catalogue this
 * work targets.
 *
 * This does NOT loosen identity: the tier was already decided before we
 * get here, and a name search only ENUMERATES more of that artist's
 * pressings. Every match still has to clear the same title-and-year
 * bar, and matches found this way are marked `viaNameSearch` so Stage 3
 * can weigh them separately if the owner wants.
 */
async function discogsSearchReleases(name, token) {
  const releases = []
  const body = await discogsJson(
    `https://api.discogs.com/database/search?type=release&artist=${encodeURIComponent(name)}&per_page=${PAGE_SIZE}&page=1`,
    token,
  )
  for (const item of body?.results ?? []) {
    const year = Number(item.year)
    releases.push({
      // Search results prefix the artist ("Artist - Title"); the part
      // after the first " - " is the release title proper.
      title: (item.title ?? '').includes(' - ')
        ? (item.title ?? '').slice((item.title ?? '').indexOf(' - ') + 3)
        : (item.title ?? ''),
      year: Number.isFinite(year) && year > 1000 ? year : null,
      type: item.type ?? null,
      label: Array.isArray(item.label) ? (item.label[0] ?? null) : (item.label ?? null),
      format: Array.isArray(item.format) ? item.format.join(', ') : (item.format ?? null),
      country: item.country ?? null,
      id: item.id ?? null,
      viaNameSearch: true,
    })
  }
  return releases
}

/** Per-decade shape of a catalogue — context for Stage 3, not evidence. */
function artistContext(releases) {
  const years = releases
    .map((r) => r.year)
    .filter((y) => y !== null)
    .sort((a, b) => a - b)
  const decades = {}
  for (const year of years) {
    const decade = Math.floor(year / 10) * 10
    decades[decade] = (decades[decade] ?? 0) + 1
  }
  return {
    releases: releases.length,
    dated: years.length,
    earliest: years[0] ?? null,
    latest: years[years.length - 1] ?? null,
    decades,
  }
}

function loadShard(dir, code) {
  const path = join(dir, `${code}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Merge, never replace — a worse run must not erase a better one. */
function foldIntoStored(existing, fresh) {
  const byId = new Map()
  for (const row of existing?.artists ?? []) byId.set(row.id, row)
  for (const row of fresh) byId.set(row.id, row)
  return { sweptAt: new Date().toISOString(), artists: [...byId.values()] }
}

async function main() {
  const token = discogsToken()
  if (!token) throw new Error('DISCOGS_TOKEN not found in env or .env.local')
  if (!artistLinksAvailable()) {
    throw new Error(
      'No artist-links index — run scripts/build-mb-artist-index.mjs first.',
    )
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  const codes = readdirSync(SWEEP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((code) => !onlyCodes || onlyCodes.includes(code))
    .sort()

  let processed = 0
  let withEvidence = 0
  let noCrosswalk = 0
  let totalMatches = 0
  let stop = false

  for (const code of codes) {
    if (stop) break
    const sweep = loadShard(SWEEP_DIR, code)
    if (!sweep) continue
    const done = new Set(
      (loadShard(OUT_DIR, code)?.artists ?? []).map((row) => row.id),
    )
    const todo = sweep.artists.filter(
      (a) => a.candidates.length > 0 && !done.has(a.id),
    )
    if (todo.length === 0) continue

    const fresh = []
    for (const artist of todo) {
      if (processed >= ARTIST_LIMIT || Date.now() - startedAt > DEADLINE_MS) {
        stop = true
        break
      }

      // Tier 1: MusicBrainz's own id-level crosswalk.
      let discogsId = discogsIdFor(artist.id)
      let tier = 'id-crosswalk'
      let p434Confirmed = null

      // Tier 2: the Wikidata two-hop — still pure IDs. Only for
      // artists MB never linked to Discogs directly.
      if (!discogsId) {
        for (const qid of wikidataQidsFor(artist.id)) {
          try {
            const hop = await wikidataDiscogsId(qid, artist.id)
            if (hop) {
              discogsId = hop.discogsId
              tier = 'wikidata-hop'
              p434Confirmed = hop.p434Confirmed
              break
            }
          } catch {
            // A failed hop just falls through to the next tier.
          }
        }
      }

      // Tier 3: exactly one Discogs artist of this exact name. Costs
      // one extra request, and only for artists no ID path reached.
      if (!discogsId) {
        let named
        try {
          named = await discogsArtistsByName(artist.name, token)
        } catch (error) {
          console.warn(`  ${code} ${artist.name}: ${error.message}`)
          continue
        }
        if (named.length === 1) {
          discogsId = named[0]
          tier = 'name-unique'
        } else {
          // Zero matches is silence; two or more is ambiguity. Both
          // yield no evidence, and both leave the music where it is.
          noCrosswalk += 1
          fresh.push({
            id: artist.id,
            name: artist.name,
            status: named.length === 0 ? 'no-discogs-artist' : 'ambiguous-name',
            nameMatches: named.length,
            candidates: [],
          })
          continue
        }
      }

      let found
      try {
        found = await discogsReleases(discogsId, token)
      } catch (error) {
        console.warn(`  ${code} ${artist.name}: ${error.message}`)
        continue
      }
      processed += 1

      const byTitle = new Map()
      let undated = 0
      const indexReleases = (list) => {
        for (const release of list) {
          if (release.year === null) {
            undated += 1
            continue
          }
          for (const key of titleKeys(release.title)) {
            const held = byTitle.get(key)
            // Keep the EARLIEST dated pressing per title; a master
            // entry wins ties because its year IS the first-release
            // year, and an id-path hit beats a name-search hit.
            if (
              !held ||
              release.year < held.year ||
              (release.year === held.year && release.type === 'master') ||
              (release.year === held.year &&
                held.viaNameSearch &&
                !release.viaNameSearch)
            ) {
              byTitle.set(key, release)
            }
          }
        }
      }
      indexReleases(found.releases)

      const unmatched = (list) =>
        list.filter((candidate) => {
          const match = byTitle.get(titleKey(candidate.title))
          return !match || match.year >= candidate.year
        })

      /**
       * ADAPTIVE SECOND PASS — only when the id path left candidates
       * unmatched, because it is what recovers credit-variant pressings
       * (Racciatti's 1964 original is filed under "Y Su Orquesta
       * Típica", a different Discogs entity).
       *
       * GATED ON NAME UNIQUENESS, and this gate is not optional. A name
       * search enumerates by NAME, so running one for an artist whose
       * name is shared would pull a DIFFERENT artist's records into the
       * title index and date a record from a stranger's catalogue —
       * precisely the John Mayer failure the tiering exists to prevent.
       * A `name-unique` artist has already cleared this; an
       * `id-crosswalk` artist has NOT, so it is checked lazily here and
       * only when the second pass is actually wanted. Not unique means
       * no second pass: less evidence, never wrong evidence.
       */
      let searched = false
      let nameUniqueChecked = tier === 'name-unique'
      if (unmatched(artist.candidates).length > 0) {
        let safeToSearch = nameUniqueChecked
        if (!safeToSearch) {
          try {
            const named = await discogsArtistsByName(artist.name, token)
            safeToSearch = named.length === 1
            nameUniqueChecked = true
          } catch {
            safeToSearch = false
          }
        }
        if (safeToSearch) {
          try {
            const extra = await discogsSearchReleases(artist.name, token)
            indexReleases(extra)
            searched = true
          } catch {
            // A failed second pass just means less evidence, never a
            // wrong answer — the record simply stays where it is.
          }
        }
      }

      const evidence = []
      for (const candidate of artist.candidates) {
        const match = byTitle.get(titleKey(candidate.title))
        // Evidence must be OLDER than what MusicBrainz says, or it is
        // not evidence of an original — it is just the same date again.
        if (!match || match.year >= candidate.year) continue
        evidence.push({
          rg: candidate.id,
          title: candidate.title,
          mbYear: candidate.year,
          reasons: candidate.reasons,
          discogsYear: match.year,
          discogsTitle: match.title,
          discogsId: match.id,
          discogsType: match.type,
          label: match.label,
          format: match.format,
          country: match.country ?? null,
          /** Found by enumerating a credit variant, not the linked id. */
          viaNameSearch: match.viaNameSearch === true,
          movesBy: candidate.year - match.year,
          /** How identity was established — Stage 3 applies the bar. */
          tier,
          /**
           * Does the proposed year fall inside the artist's own
           * documented working life? A supporting fact, recorded rather
           * than enforced: a true original necessarily does, but a
           * career start that is a birth date +15 makes this a soft
           * signal, not a test worth failing a record on here.
           */
          inWindow:
            artist.cs !== null &&
            match.year >= artist.cs &&
            (artist.end === null || match.year <= artist.end),
        })
      }

      if (evidence.length > 0) withEvidence += 1
      totalMatches += evidence.length
      fresh.push({
        id: artist.id,
        name: artist.name,
        discogsId,
        tier,
        ...(p434Confirmed !== null ? { p434Confirmed } : {}),
        status: 'checked',
        cs: artist.cs,
        end: artist.end,
        truncated: found.truncated,
        searched,
        /**
         * Discogs entries carrying no year at all. The coverage ceiling
         * on this whole stage, and it lands hardest on the pre-LP
         * records that most need re-dating — both of Racciatti's
         * "Tu Corazon" pressings on his artist page are undated. Counted
         * so the limit is reported rather than discovered later.
         */
        undatedSeen: undated,
        context: artistContext(found.releases),
        /**
         * The artist's full title→earliest-year map, PERSISTED (owner
         * rule, Aug 31: music belongs to when it was CREATED — the best
         * case is dating each song to its own era). This map is the
         * per-song foundation: for vintage artists Discogs's singles
         * ("A-side / B-side") are per-SONG dates, and the queue's
         * playable unit is a title, so this is what a per-song
         * correction layer reads. Collected on this pass because it is
         * already in memory — re-deriving it later would cost the whole
         * sweep again. Compact rows: [titleKey, year, viaNameSearch].
         */
        titleYears: [...byTitle.entries()]
          .slice(0, 500)
          .map(([key, row]) => [key, row.year, row.viaNameSearch ? 1 : 0]),
        candidatesChecked: artist.candidates.length,
        candidates: evidence,
      })

      if (processed % 25 === 0) {
        writeFileSync(
          join(OUT_DIR, `${code}.json`),
          JSON.stringify(foldIntoStored(loadShard(OUT_DIR, code), fresh)) + '\n',
        )
        const mins = ((Date.now() - startedAt) / 60000).toFixed(0)
        console.log(
          `  ${processed} checked · ${withEvidence} with evidence · ${totalMatches} datable records · ${mins}m`,
        )
      }
    }

    if (fresh.length > 0) {
      writeFileSync(
        join(OUT_DIR, `${code}.json`),
        JSON.stringify(foldIntoStored(loadShard(OUT_DIR, code), fresh)) + '\n',
      )
      console.log(`  ${code}: +${fresh.length} artists`)
    }
  }

  console.log(
    `\nPASS DONE — ${processed} artists checked, ${withEvidence} with evidence, ${totalMatches} records datable, ${noCrosswalk} without a Discogs crosswalk.`,
  )
  if (stop) console.log('Stopped on --limit/--minutes; re-run to continue.')
}

main().catch((error) => {
  console.error('evidence sweep failed:', error.message)
  process.exit(1)
})
