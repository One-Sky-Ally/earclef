/**
 * Self-filed artists — the cap-bypass list behind /get-on-the-map.
 *
 * Proof of control, not proof of identity: the artist posts a token we
 * mint on a page only they can edit (Bandcamp bio, YouTube channel
 * description, their own site), we fetch the page and see it. Each
 * entry carries its own evidence — the page, the token, the date it
 * was seen — and lib/explore/selfFiled.ts serves an entry ONLY when all
 * three are present.
 *
 * Usage:
 *   node scripts/self-filed.mjs mint <mbid> --url <page>   # add + print token
 *   node scripts/self-filed.mjs verify [mbid]              # fetch page(s), record the date
 *   node scripts/self-filed.mjs refresh                    # re-read MB fields for verified rows
 *   node scripts/self-filed.mjs list
 *
 * The page host must be one the artist controls. The open catalogs and
 * this site are refused: a token on a MusicBrainz or Discogs page proves
 * an editor account, not the act, and a token here would be circular.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const LIST_PATH = 'lib/explore/self-filed.json'
const MB_USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
/** Page fetches: some hosts serve a stub to unknown agents. */
const PAGE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const REFUSED_HOSTS = [
  'musicbrainz.org',
  'discogs.com',
  'wikidata.org',
  'wikipedia.org',
  'earclef.com',
]
const MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REGION_PATTERN = /^(?:US-[A-Z]{2}|GB-[A-Z]{3})$/
const MAX_PARENT_HOPS = 4
const MB_DELAY_MS = 1100
/** Precompute parity: a person's career starts ~15y after birth. */
const PERSON_CAREER_OFFSET_YEARS = 15
const KEEP_TAGS = 6
const TOKEN_PREFIX = 'earclef-'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readList() {
  const parsed = JSON.parse(readFileSync(LIST_PATH, 'utf8'))
  return { generatedAt: parsed.generatedAt ?? null, artists: parsed.artists ?? [] }
}

function writeList(artists) {
  const next = { generatedAt: new Date().toISOString(), artists }
  writeFileSync(LIST_PATH, JSON.stringify(next, null, 2) + '\n')
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index !== -1 ? process.argv[index + 1] : undefined
}

function mintToken() {
  return TOKEN_PREFIX + randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')
}

function assertControllablePage(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`not a URL: ${url}`)
  }
  if (parsed.protocol !== 'https:') throw new Error('page must be https')
  const host = parsed.hostname.toLowerCase()
  const refused = REFUSED_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  )
  if (refused) {
    throw new Error(
      `${host} is an open catalog or this site — a token there proves an account, not the act`,
    )
  }
  return parsed.toString()
}

async function mbJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': MB_USER_AGENT } })
  if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status} for ${url}`)
  return res.json()
}

function regionCodeOf(area) {
  return (area?.['iso-3166-2-codes'] ?? []).find((code) => REGION_PATTERN.test(code))
}

/**
 * Walk "part of" upward, collecting the first region code (US-NV,
 * GB-SCT) and the first country code met. MusicBrainz leaves an
 * artist's `country` EMPTY when their Area is a city (bLiNd, Area =
 * Las Vegas, country: null), so the country has to come from the walk
 * exactly as the search route derives it — or an artist who files the
 * city their music happened in would fall off the map.
 */
async function resolvePlace(area) {
  let region = null
  let current = area
  for (let hop = 0; hop < MAX_PARENT_HOPS && current; hop++) {
    region = region ?? regionCodeOf(current) ?? null
    const country = current['iso-3166-1-codes']?.[0]
    if (country) return { region, country }
    await sleep(MB_DELAY_MS)
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/area/${current.id}?inc=area-rels&fmt=json`,
    )
    region = region ?? regionCodeOf(body) ?? null
    const bodyCountry = body['iso-3166-1-codes']?.[0]
    if (bodyCountry) return { region, country: bodyCountry }
    const partOf = (body.relations ?? []).filter(
      (rel) => rel.type === 'part of' && rel.area,
    )
    current =
      partOf.find((rel) => rel.direction === 'backward')?.area ??
      partOf[0]?.area ??
      null
  }
  return { region, country: null }
}

/** The MusicBrainz record, reduced to what the serving layers rank. */
async function mbArtist(mbid) {
  const artist = await mbJson(
    `https://musicbrainz.org/ws/2/artist/${mbid}?inc=tags&fmt=json`,
  )
  const beginYear = Number(artist['life-span']?.begin?.slice(0, 4))
  const endYear = Number(artist['life-span']?.end?.slice(0, 4))
  const voted = (artist.tags ?? []).filter((tag) => (tag.count ?? 0) > 0)
  // Country comes from Area only (the country layer's rule). Region is
  // Area OR begin-area, as build-state-data.mjs discovers regions: The
  // Killers carry Area = United States and Begin area = Las Vegas, and
  // it is the second that places them in Nevada.
  const fromArea = artist.area
    ? await resolvePlace(artist.area)
    : { region: null, country: null }
  const fromBegin =
    !fromArea.region && artist['begin-area']
      ? await resolvePlace(artist['begin-area'])
      : null
  const region = fromArea.region ?? fromBegin?.region ?? null
  const country = artist.country ?? fromArea.country ?? null
  if (!country) {
    throw new Error(
      `${artist.name} has no Area that resolves to a country on MusicBrainz — the Area field is what puts an artist on the map`,
    )
  }
  return {
    name: artist.name,
    country,
    region,
    cs: Number.isFinite(beginYear)
      ? beginYear + (artist.type === 'Person' ? PERSON_CAREER_OFFSET_YEARS : 0)
      : null,
    end: Number.isFinite(endYear) ? endYear : null,
    tags: voted
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, KEEP_TAGS)
      .flatMap((tag) => (tag.name ? [tag.name] : [])),
  }
}

/** True only when a non-empty token is found in a non-empty page body. */
async function tokenOnPage(url, token) {
  if (!token || token.length <= TOKEN_PREFIX.length) return false
  const res = await fetch(url, {
    headers: { 'User-Agent': PAGE_USER_AGENT, Accept: 'text/html,*/*' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`page HTTP ${res.status}`)
  const body = await res.text()
  return body.length > 0 && body.includes(token)
}

async function mint() {
  const mbid = process.argv[3]
  const url = flagValue('--url')
  if (!MBID_PATTERN.test(mbid ?? '')) throw new Error('mint needs a MusicBrainz artist id')
  if (!url) throw new Error('mint needs --url <page the artist controls>')
  const page = assertControllablePage(url)
  const list = readList()
  if (list.artists.some((artist) => artist.mbid === mbid)) {
    throw new Error(`${mbid} is already on the list — use verify or refresh`)
  }
  const record = await mbArtist(mbid)
  const entry = {
    mbid,
    ...record,
    filedAt: new Date().toISOString(),
    evidence: { url: page, token: mintToken(), verifiedAt: null },
  }
  writeList([...list.artists, entry])
  console.log(`Added ${record.name} (${record.country}${record.region ? `, ${record.region}` : ''}).`)
  console.log(`Token to send: ${entry.evidence.token}`)
  console.log(`They post it on ${page}; then run: node scripts/self-filed.mjs verify ${mbid}`)
}

async function verify() {
  const only = process.argv[3]
  const list = readList()
  const targets = list.artists.filter(
    (artist) => (!only || artist.mbid === only) && (only || !artist.evidence.verifiedAt),
  )
  if (targets.length === 0) {
    console.log('Nothing to verify.')
    return
  }
  const results = new Map()
  for (const artist of targets) {
    try {
      const seen = await tokenOnPage(artist.evidence.url, artist.evidence.token)
      results.set(artist.mbid, seen ? new Date().toISOString() : null)
      console.log(`${seen ? 'VERIFIED' : 'not found'}  ${artist.name}  ${artist.evidence.url}`)
    } catch (error) {
      results.set(artist.mbid, null)
      console.log(`FAILED     ${artist.name}  ${error.message}`)
    }
  }
  const updated = list.artists.map((artist) => {
    const verifiedAt = results.get(artist.mbid)
    return verifiedAt
      ? { ...artist, evidence: { ...artist.evidence, verifiedAt } }
      : artist
  })
  writeList(updated)
}

async function refresh() {
  const list = readList()
  const refreshed = []
  for (const artist of list.artists) {
    if (!artist.evidence.verifiedAt) {
      refreshed.push(artist)
      continue
    }
    try {
      const record = await mbArtist(artist.mbid)
      refreshed.push({ ...artist, ...record })
      console.log(`refreshed  ${record.name}`)
    } catch (error) {
      refreshed.push(artist)
      console.log(`kept       ${artist.name}  (${error.message})`)
    }
    await sleep(MB_DELAY_MS)
  }
  writeList(refreshed)
}

function list() {
  const { artists } = readList()
  if (artists.length === 0) {
    console.log('No self-filed artists yet.')
    return
  }
  for (const artist of artists) {
    const status = artist.evidence.verifiedAt
      ? `verified ${artist.evidence.verifiedAt.slice(0, 10)}`
      : 'UNVERIFIED (not served)'
    console.log(`${artist.mbid}  ${artist.name}  ${artist.country}${artist.region ? `/${artist.region}` : ''}  ${status}`)
  }
}

const COMMANDS = { mint, verify, refresh, list }

async function main() {
  const command = COMMANDS[process.argv[2]]
  if (!command) {
    console.error('usage: node scripts/self-filed.mjs <mint|verify|refresh|list>')
    process.exit(2)
  }
  await command()
}

main().catch((error) => {
  console.error(`self-filed ${process.argv[2]} failed: ${error.message}`)
  process.exit(1)
})
