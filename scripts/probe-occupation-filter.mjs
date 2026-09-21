/**
 * READ-ONLY DIAGNOSTIC (Sep 2026) — measures what the exact-QID
 * occupation filter in build-extra-artists.mjs (wikidataPass) excludes
 * versus a subclass-aware one, per gap-fill country. Queries Wikidata,
 * reads the committed pool, and writes ONLY:
 *   data/occupation-filter-probe.json   raw per-country result (resumable)
 *   data/occupation-filter-lists.json   bucketed per-artist lists + the
 *                                       owner ruling they are held under
 * It never touches the dataset or the sweep's work file. The fix itself
 * is PROPOSED, NOT BUILT — see the handoff entry of Sep 21, 2026.
 *
 * Usage: node scripts/probe-occupation-filter.mjs [CC ...] [--lists-only]
 *        [--max-minutes=N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { COUNTRIES } from './lib/gap-fill-countries.mjs'

const PROBE_PATH = 'data/occupation-filter-probe.json'
const LISTS_PATH = 'data/occupation-filter-lists.json'
const POOL_PATH = 'lib/explore/extra-artists.json'
const UA = 'EarClefDiagnostic/1.0 (https://earclef.com; read-only occupation-filter probe)'
const LABEL_LANGS =
  'en,es,fr,pt,ar,fa,ru,uk,sq,hy,az,ro,vi,km,my,dz,ne,si,bn,mn,th,lo,uz,tg,ky,tk,kk,ms,sw,am,ti,so,ha,yo,da,kl'

/** What the sweep admits today — exact matches only. */
const CURRENT_P106 = new Set(['Q639669', 'Q177220', 'Q36834', 'Q488205'])
const CURRENT_P31 = new Set(['Q215380'])

/**
 * Classes a subclass walk reaches that are NOT performers. Sole
 * membership here keeps an artist OUT (Yemen: 144 songwriter-only
 * items are a batch import of lyric poets; Wikidata files Quran
 * reciters under singer).
 */
const EXCLUDE = new Set([
  'Q753110', // songwriter
  'Q16145150', // music educator
  'Q81759238', // music professor
  'Q3595924', // qāriʾ
  'Q23037330', // reciter
  'Q625163', // hafiz
  'Q10730252', // radio DJ
  'Q7939609', // voice teacher
  'Q101572682', // guitar teacher
])

/** Owner-ruled classes — admitted per artist, never per class. */
const OWNER_RULED = new Set([
  'Q183945', // record producer
  'Q158852', // conductor
  'Q1076502', // choir director
  'Q42227156', // chorus master
  'Q691031', // concertmaster
  'Q1643514', // music arranger
  'Q17378128', // spoken word artist
  'Q4087517', // beatmaker
])

const OWNER_RULING = {
  ruledOn: '2026-09-21',
  appliesTo: 'ownerRuled bucket (conductors, choir directors, record-producer-only, spoken word, arrangers, beatmakers)',
  rule:
    'Any of them can be added if they made and released original audio. If they did not, leave them out. ' +
    'Spoken word gets in only if it is over music or delivered with some melody. Unsung speech with no music behind it stays out.',
  howToApply:
    'Per artist at build time: admission needs POSITIVE evidence of a released original recording ' +
    '(a Discogs/MB release credited to them as artist, or an equivalent verified record). ' +
    'No evidence is not a pass — absent never satisfies the check.',
}

const argv = process.argv.slice(2)
const LISTS_ONLY = argv.includes('--lists-only')
const maxMinutes = Number(argv.find((arg) => arg.startsWith('--max-minutes='))?.split('=')[1]) || null
const requested = argv.filter((arg) => !arg.startsWith('--'))
const startedAt = Date.now()

function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

async function sparql(query, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(
        `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
        {
          headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
          signal: AbortSignal.timeout(90000),
        },
      )
      if (res.status === 429 || res.status >= 500) {
        console.log(`  retry ${attempt}: HTTP ${res.status}`)
        await sleep(5000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).results.bindings
    } catch (error) {
      console.log(`  retry ${attempt}: ${error.message}`)
      if (attempt === tries) throw error
      await sleep(3000 * attempt)
    }
  }
  throw new Error('exhausted retries')
}

/** The sweep's query with a P279* walk; ?cls says what admitted the item. */
const broadQuery = (qid) => `SELECT ?item ?itemLabel ?mbid ?discogs ?bornIn ?formedIn ?citizen ?cls ?via WHERE {
  { ?item wdt:P27 wd:${qid} } UNION { ?item wdt:P495 wd:${qid} }
  { ?item wdt:P106 ?cls . ?cls wdt:P279* ?root . VALUES ?root { wd:Q639669 wd:Q177220 wd:Q36834 wd:Q488205 } BIND("P106" AS ?via) }
  UNION { ?item wdt:P31 ?cls . ?cls wdt:P279* wd:Q215380 . BIND("P31" AS ?via) }
  OPTIONAL { ?item wdt:P434 ?mbid }
  OPTIONAL { ?item wdt:P1953 ?discogs }
  OPTIONAL { ?item wdt:P19 ?bp . ?bp wdt:P17 ?bornIn }
  OPTIONAL { ?item wdt:P740 ?fp . ?fp wdt:P17 ?formedIn }
  OPTIONAL { ?item wdt:P27 ?citizen }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}". }
}`

const tail = (binding) => binding?.value.split('/').pop() ?? null

function collectItems(rows) {
  const byItem = new Map()
  for (const row of rows) {
    const id = tail(row.item)
    const entry = byItem.get(id) ?? {
      id,
      name: row.itemLabel?.value ?? '',
      mbid: row.mbid?.value ?? null,
      discogsId: row.discogs?.value ?? null,
      bornIn: null,
      formedIn: null,
      citizenships: new Set(),
      classes: new Set(),
    }
    entry.bornIn ??= tail(row.bornIn)
    entry.formedIn ??= tail(row.formedIn)
    if (row.citizen) entry.citizenships.add(tail(row.citizen))
    entry.classes.add(`${row.via.value}:${tail(row.cls)}`)
    byItem.set(id, entry)
  }
  return [...byItem.values()]
}

const passesCurrentFilter = (entry) =>
  [...entry.classes].some((tagged) => {
    const [via, cls] = tagged.split(':')
    return via === 'P106' ? CURRENT_P106.has(cls) : CURRENT_P31.has(cls)
  })

/** Both sides present before any equality means anything (lesson 5). */
function poolMatcher(committed) {
  const byWikidata = new Set(committed.map((artist) => artist.wikidataId).filter(Boolean))
  const byDiscogs = new Map()
  const byName = new Map()
  for (const artist of committed) {
    if (artist.discogsArtistId != null) byDiscogs.set(String(artist.discogsArtistId), artist)
    for (const label of [artist.name, ...(artist.aliases ?? [])]) {
      const key = normalize(label)
      if (key !== '' && !byName.has(key)) byName.set(key, artist)
    }
  }
  return (entry) => {
    if (byWikidata.has(entry.id)) return { how: 'wikidataId', artist: null }
    if (entry.discogsId !== null && byDiscogs.has(String(entry.discogsId))) {
      return { how: 'discogsId', artist: byDiscogs.get(String(entry.discogsId)) }
    }
    const key = normalize(entry.name)
    if (key !== '' && byName.has(key)) return { how: 'name', artist: byName.get(key) }
    return null
  }
}

function classify(entry, qid, matchPool) {
  const record = {
    wikidataId: entry.id,
    name: entry.name,
    classes: [...entry.classes],
    discogsId: entry.discogsId,
    mbid: entry.mbid,
  }
  if (!entry.name || /^Q\d+$/.test(entry.name)) return ['unlabelled', record]
  const match = matchPool(entry)
  if (entry.mbid) {
    const poolEntry = match?.artist
      ? { name: match.artist.name, discogsArtistId: match.artist.discogsArtistId ?? null, matchedBy: match.how }
      : null
    return ['mbKnown', { ...record, poolEntry }]
  }
  const origin = entry.formedIn ?? entry.bornIn
  if (origin && origin !== qid && !entry.citizenships.has(qid)) return ['foreignByOrigin', record]
  return [match ? 'alreadyInPool' : 'recoverable', record]
}

async function probeCountry(code, pool) {
  const qid = COUNTRIES[code].qid
  const items = collectItems(await sparql(broadQuery(qid)))
  const matchPool = poolMatcher(pool.countries[code] ?? [])
  const buckets = { unlabelled: [], mbKnown: [], foreignByOrigin: [], alreadyInPool: [], recoverable: [] }
  const delta = items.filter((entry) => !passesCurrentFilter(entry))
  for (const entry of delta) {
    const [bucket, record] = classify(entry, qid, matchPool)
    buckets[bucket].push(record)
  }
  return { qid, probedAt: new Date().toISOString(), passesToday: items.length - delta.length, broad: items.length, delta: delta.length, ...buckets }
}

function bucketOf(record) {
  const classes = record.classes.map((tagged) => tagged.split(':')[1])
  if (classes.some((cls) => !EXCLUDE.has(cls) && !OWNER_RULED.has(cls))) return 'performer'
  return classes.some((cls) => OWNER_RULED.has(cls)) ? 'ownerRuled' : 'excluded'
}

function writeLists(probe) {
  const countries = {}
  const totals = { performer: 0, ownerRuled: 0, excluded: 0, possibleMbDuplicatesInPool: 0 }
  for (const [code, result] of Object.entries(probe.countries)) {
    const lists = { performer: [], ownerRuled: [], excluded: [] }
    for (const record of result.recoverable) lists[bucketOf(record)].push(record)
    const possibleMbDuplicatesInPool = result.mbKnown.filter((record) => record.poolEntry)
    countries[code] = { ...lists, possibleMbDuplicatesInPool }
    for (const key of Object.keys(lists)) totals[key] += lists[key].length
    totals.possibleMbDuplicatesInPool += possibleMbDuplicatesInPool.length
  }
  const out = {
    generatedAt: new Date().toISOString(),
    status: 'PROPOSED, NOT BUILT — nothing here has been applied to the dataset',
    countriesProbed: Object.keys(probe.countries).length,
    totals,
    ownerRuling: OWNER_RULING,
    excludedClasses: [...EXCLUDE],
    ownerRuledClasses: [...OWNER_RULED],
    countries,
  }
  writeFileSync(LISTS_PATH, JSON.stringify(out, null, 1))
  console.log(`lists → ${LISTS_PATH}: ${JSON.stringify(totals)} over ${out.countriesProbed} countries`)
}

async function main() {
  let probe = existsSync(PROBE_PATH) ? JSON.parse(readFileSync(PROBE_PATH, 'utf8')) : { countries: {} }
  if (!LISTS_ONLY) {
    const pool = JSON.parse(readFileSync(POOL_PATH, 'utf8'))
    const targets = requested.length ? requested : Object.keys(pool.countries)
    for (const code of targets) {
      if (probe.countries[code] || !COUNTRIES[code]) continue
      if (maxMinutes !== null && Date.now() - startedAt > maxMinutes * 60000) {
        console.log(`TIME CAP ${maxMinutes} min reached — stopping cleanly (resumable)`)
        break
      }
      try {
        const result = await probeCountry(code, pool)
        probe = { ...probe, countries: { ...probe.countries, [code]: result } }
        writeFileSync(PROBE_PATH, JSON.stringify(probe))
        console.log(
          `${code} passes today ${result.passesToday} | broad ${result.broad} | delta ${result.delta}:` +
            ` mb ${result.mbKnown.length} foreign ${result.foreignByOrigin.length}` +
            ` inPool ${result.alreadyInPool.length} recoverable ${result.recoverable.length}`,
        )
      } catch (error) {
        console.log(`${code} FAILED: ${error.message}`)
        await sleep(15000)
      }
      await sleep(1200)
    }
  }
  writeLists(probe)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
