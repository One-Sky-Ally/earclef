/**
 * Confirm, per roster artist and streaming service, whether the artist
 * is on the service — so the site can show "*Not on Spotify" ONLY when
 * that is confirmed (owner rule, Oct 13 2026: a missing link in our
 * data is not proof). Writes lib/listen/service-absence.json, which
 * lib/listen/serviceAbsence.ts reads at build time.
 *
 * RUNS ON THE OWNER'S MAC: the cloud container cannot reach
 * musicbrainz.org, itunes.apple.com, api.deezer.com, Spotify or TIDAL.
 *
 *   node scripts/verify-service-absence.mjs                 # every artist, every service
 *   node scripts/verify-service-absence.mjs --slug joanna-newsom
 *   node scripts/verify-service-absence.mjs --service spotify
 *
 * Credentials (env or .env.local; a service with none is skipped and
 * stays `unknown`, never `absent`):
 *   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   — any Spotify developer app
 *   TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET       — developer.tidal.com app
 * Apple Music (iTunes Search API) and Deezer need no key. Amazon Music
 * has no public search: it is confirmed only by a link (content file or
 * MusicBrainz) and otherwise stays unknown — the owner's `listen.notOn`
 * is the only way to claim an Amazon absence.
 *
 * Three legs per pair, decided by scripts/lib/serviceAbsenceVerdict.mjs:
 *   content     — a platform link or id for the service in content/*.json
 *   musicbrainz — a URL relation on the artist's own MusicBrainz record
 *   search      — the service's artist search, exact normalized name
 * Rate limits honoured: MusicBrainz 1/s, iTunes ~20/min, Deezer 50/5s.
 * Earlier verdicts survive a run that could not re-check them (their
 * old checkedAt stays — the file never pretends a check happened).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getJson } from './lib/fetchJson.mjs'
import {
  SERVICES,
  decideVerdict,
  describeLegs,
  hostMatchesService,
  searchNamesArtist,
} from './lib/serviceAbsenceVerdict.mjs'

const CONTENT_DIR = join(process.cwd(), 'content')
const OUT_PATH = join(process.cwd(), 'lib', 'listen', 'service-absence.json')
const USER_AGENT = 'EarClefServiceAbsence/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- args + env -----------------------------------------------------------

const args = process.argv.slice(2)
const argValue = (flag) => {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1] ?? null
}
const onlySlug = argValue('--slug')
const onlyService = argValue('--service')
if (onlyService && !SERVICES.includes(onlyService)) {
  throw new Error(`--service must be one of ${SERVICES.join(', ')}`)
}

function env(name) {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

// --- roster ---------------------------------------------------------------

const roster = readdirSync(CONTENT_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8')))
  .filter((artist) => !onlySlug || artist.slug === onlySlug)
  .sort((a, b) => a.hero.name.localeCompare(b.hero.name))
if (roster.length === 0) throw new Error('no roster artist matched')

/** Leg 1: what the content file itself holds for the service. */
function contentLeg(artist, service) {
  const platforms = artist.listen?.platforms ?? []
  if (platforms.some((p) => p.platform === service && p.url)) return 'present'
  if (service === 'spotify' && artist.integrations?.spotify?.artistId) return 'present'
  if (service === 'appleMusic' && artist.integrations?.itunes?.artistId) return 'present'
  if (platforms.some((p) => p.url && hostMatchesService(p.url, service))) return 'present'
  return 'absent'
}

// --- MusicBrainz leg (one call per artist, shared by every service) ------

const mbCache = new Map()
async function musicbrainzUrls(mbid) {
  if (!mbid) return null
  if (mbCache.has(mbid)) return mbCache.get(mbid)
  let urls
  try {
    const body = await getJson(
      `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`,
      { 'User-Agent': USER_AGENT },
      { timeoutMs: 30_000 },
    )
    urls = (body.relations ?? []).map((rel) => rel.url?.resource).filter(Boolean)
  } catch (error) {
    console.warn(`  musicbrainz ${mbid}: ${error.message}`)
    urls = 'failed'
  }
  mbCache.set(mbid, urls)
  await sleep(1100)
  return urls
}

function musicbrainzLeg(urls, service) {
  if (urls === null) return 'no-record'
  if (urls === 'failed') return 'failed'
  return urls.some((url) => hostMatchesService(url, service)) ? 'present' : 'absent'
}

// --- Service search legs --------------------------------------------------

let spotifyToken = null
async function spotifyAuth() {
  const id = env('SPOTIFY_CLIENT_ID')
  const secret = env('SPOTIFY_CLIENT_SECRET')
  if (!id || !secret) return null
  if (spotifyToken) return spotifyToken
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`spotify auth HTTP ${res.status}`)
  spotifyToken = (await res.json()).access_token
  return spotifyToken
}

let tidalToken = null
async function tidalAuth() {
  const id = env('TIDAL_CLIENT_ID')
  const secret = env('TIDAL_CLIENT_SECRET')
  if (!id || !secret) return null
  if (tidalToken) return tidalToken
  const res = await fetch('https://auth.tidal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`tidal auth HTTP ${res.status}`)
  tidalToken = (await res.json()).access_token
  return tidalToken
}

/**
 * Names the service's artist search returns for the query, or
 * 'unavailable' (no credentials / no public search) — never a guess.
 */
async function searchHitNames(service, name) {
  const q = encodeURIComponent(name)
  switch (service) {
    case 'spotify': {
      const token = await spotifyAuth()
      if (!token) return 'unavailable'
      const body = await getJson(
        `https://api.spotify.com/v1/search?type=artist&limit=10&q=${q}`,
        { Authorization: `Bearer ${token}` },
        { timeoutMs: 30_000 },
      )
      await sleep(250)
      return (body.artists?.items ?? []).map((a) => a.name)
    }
    case 'appleMusic': {
      const body = await getJson(
        `https://itunes.apple.com/search?entity=musicArtist&limit=10&term=${q}`,
        { 'User-Agent': USER_AGENT },
        { timeoutMs: 30_000 },
      )
      await sleep(3500)
      return (body.results ?? []).map((a) => a.artistName)
    }
    case 'deezer': {
      const body = await getJson(
        `https://api.deezer.com/search/artist?limit=10&q=${q}`,
        { 'User-Agent': USER_AGENT },
        { timeoutMs: 30_000 },
      )
      await sleep(300)
      return (body.data ?? []).map((a) => a.name)
    }
    case 'tidal': {
      const token = await tidalAuth()
      if (!token) return 'unavailable'
      const body = await getJson(
        `https://openapi.tidal.com/v2/searchResults/${q}?countryCode=US&include=artists`,
        { Authorization: `Bearer ${token}`, Accept: 'application/vnd.api+json' },
        { timeoutMs: 30_000 },
      )
      await sleep(300)
      return (body.included ?? [])
        .filter((item) => item.type === 'artists')
        .map((item) => item.attributes?.name)
        .filter(Boolean)
    }
    default:
      return 'unavailable'
  }
}

async function searchLeg(service, name) {
  try {
    const hits = await searchHitNames(service, name)
    if (hits === 'unavailable') return { leg: 'unavailable', detail: 'no public search or no credentials' }
    const present = searchNamesArtist(hits, name)
    return {
      leg: present ? 'present' : 'absent',
      detail: present
        ? 'artist search returned this exact name'
        : `artist search returned ${hits.length} hit${hits.length === 1 ? '' : 's'}, none of this name`,
    }
  } catch (error) {
    console.warn(`  ${service} search "${name}": ${error.message}`)
    return { leg: 'failed', detail: error.message }
  }
}

// --- run ------------------------------------------------------------------

const previous = existsSync(OUT_PATH)
  ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
  : { generatedAt: null, artists: {} }
const out = { generatedAt: new Date().toISOString(), artists: { ...previous.artists } }
const services = onlyService ? [onlyService] : SERVICES
const counts = { present: 0, absent: 0, unknown: 0 }

for (const artist of roster) {
  const name = artist.hero.name
  const mbid = artist.integrations?.setlistfm?.mbid || null
  console.log(`${name}${mbid ? '' : ' (no MusicBrainz id)'}`)
  const urls = await musicbrainzUrls(mbid)
  const verdicts = { ...(out.artists[artist.slug] ?? {}) }
  for (const service of services) {
    const legs = {
      content: contentLeg(artist, service),
      musicbrainz: musicbrainzLeg(urls, service),
      search: 'unavailable',
    }
    let searchDetail = ''
    // Searching is only worth the call when nothing else proved presence.
    if (legs.content !== 'present' && legs.musicbrainz !== 'present') {
      const searched = await searchLeg(service, name)
      legs.search = searched.leg
      searchDetail = searched.detail
    }
    const status = decideVerdict(legs)
    counts[status] += 1
    const prior = verdicts[service]
    if (status === 'unknown' && prior && prior.status !== 'unknown') {
      // Could not re-check: the earlier verdict stands, with its own date.
      console.log(`  ${service}: unknown now — keeping ${prior.status} from ${prior.checkedAt.slice(0, 10)}`)
      continue
    }
    verdicts[service] = {
      status,
      checkedAt: new Date().toISOString(),
      evidence: describeLegs(legs, { searchDetail }),
    }
    console.log(`  ${service}: ${status} — ${verdicts[service].evidence}`)
  }
  out.artists[artist.slug] = verdicts
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n')
console.log(
  `\nwrote ${OUT_PATH}: ${counts.present} present · ${counts.absent} absent · ${counts.unknown} unknown (this run)`,
)
