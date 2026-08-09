/**
 * Gap-fill verified-play sweep (approved Aug 8, 2026): for every
 * Discogs/Wikidata gap-fill artist, find a VERIFIED play destination.
 *
 *   node scripts/build-extra-play.mjs             # full sweep (resumable)
 *   node scripts/build-extra-play.mjs --assemble  # work file -> lib JSON only
 *
 * Chain per artist — no fuzzy matching anywhere (exact normalized
 * equality against the alias set only):
 *   1. Alias set: credit name, its "A = B" script variants (same
 *      artist per Discogs ANV convention; "/" joint credits are NOT
 *      split), Wikidata labels+aliases when a Q-id exists.
 *   2. Discogs artist id: native from the dataset, else ONE search
 *      accepted only on exact alias equality (recovers ids for the
 *      169 entries whose pills currently fall back to a name search).
 *   3. Discogs release videos: community links tied to that exact
 *      release; candidates pass a YouTube playability check
 *      (public + embeddable) before they count.
 *   4. Internet Archive audio whose creator exact-matches an alias.
 *   5. Nothing — the panel keeps its honest no-badge state.
 *
 * Rates: Discogs ~55/min authed (DISCOGS_TOKEN from .env.local — the
 * live site never calls Discogs, the token stays local), IA ~1/s,
 * YouTube videos.list ≤1 unit per artist. Zero Anthropic calls.
 * Resumable via data/extra-play-work.json; output committed to
 * lib/explore/extra-play.json for the /api/play route to serve.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DATASET_PATH = join(ROOT, 'lib', 'explore', 'extra-artists.json')
const WORK_PATH = join(ROOT, 'data', 'extra-play-work.json')
const OUT_PATH = join(ROOT, 'lib', 'explore', 'extra-play.json')
const LOG_PATH = join(ROOT, 'data', 'extra-play.log')
const UA = 'EarClefExtraPlay/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

const DISCOGS_DELAY_MS = 1100
const ARCHIVE_DELAY_MS = 700
const RELEASE_DETAIL_CAP = 4
const VIDEO_CANDIDATE_CAP = 8

function env(name) {
  if (process.env[name]) return process.env[name]
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return null
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && match[1] === name) return match[2].trim()
  }
  return null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  appendFileSync(LOG_PATH, `${stamped}\n`)
}

/** Same normalization as lib/play/resolve.ts — script-aware, exact. */
function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** MUST mirror extraPlayKey in lib/explore/extraArtists.ts exactly. */
function extraPlayKey(artist) {
  if (artist.discogsArtistId) return `dg:${artist.discogsArtistId}`
  if (artist.wikidataId) return `wd:${artist.wikidataId}`
  const slug = artist.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `nm:${slug || `h${djb2(artist.name)}`}`
}

function djb2(value) {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

async function getJson(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 429) {
      await sleep(5000)
      return getJson(url, headers)
    }
    if (!res.ok) return null
    return await res.json()
  } catch (error) {
    log(`  fetch failed ${url.slice(0, 90)}: ${error.message}`)
    return null
  }
}

/** Alias set: credit name + "=" script variants + Wikidata labels. */
async function buildAliases(artist) {
  const aliases = [
    artist.name,
    ...artist.name
      .split('=')
      .map((segment) => segment.replace(/\*\s*$/, '').trim())
      .filter((segment) => segment.length > 1),
  ]
  if (artist.wikidataId) {
    const body = await getJson(
      `https://www.wikidata.org/wiki/Special:EntityData/${artist.wikidataId}.json`,
    )
    const entity = body?.entities?.[artist.wikidataId]
    for (const label of Object.values(entity?.labels ?? {})) {
      if (label?.value) aliases.push(label.value)
    }
    for (const list of Object.values(entity?.aliases ?? {})) {
      for (const alias of list ?? []) {
        if (alias?.value) aliases.push(alias.value)
      }
    }
    await sleep(250)
  }
  const seen = new Set()
  return aliases.filter((alias) => {
    const key = normalizeName(alias)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Discogs result titles carry "(2)" disambiguators — strip to compare. */
function discogsTitleMatches(title, aliases) {
  const cleaned = title.replace(/\s*\(\d+\)\s*$/, '')
  const key = normalizeName(cleaned)
  return key && aliases.some((alias) => normalizeName(alias) === key)
}

/** Recover a Discogs artist id: exact alias equality only, one search. */
async function recoverDiscogsId(aliases, token) {
  for (const alias of aliases.slice(0, 2)) {
    const body = await getJson(
      `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(alias)}&per_page=10&token=${token}`,
    )
    await sleep(DISCOGS_DELAY_MS)
    for (const result of body?.results ?? []) {
      if (result?.id && discogsTitleMatches(result.title ?? '', aliases)) {
        return result.id
      }
    }
  }
  return null
}

/** YouTube ids from the videos community attached to the artist's releases. */
async function discogsReleaseVideoIds(artistId, token) {
  const releasesBody = await getJson(
    `https://api.discogs.com/artists/${artistId}/releases?per_page=100&token=${token}`,
  )
  await sleep(DISCOGS_DELAY_MS)
  const releases = (releasesBody?.releases ?? []).filter((r) => r?.id)
  releases.sort((a, b) => (a.role === 'Main' ? 0 : 1) - (b.role === 'Main' ? 0 : 1))
  const ids = []
  for (const release of releases.slice(0, RELEASE_DETAIL_CAP)) {
    const detail = await getJson(
      `https://api.discogs.com/releases/${release.id}?token=${token}`,
    )
    await sleep(DISCOGS_DELAY_MS)
    for (const video of detail?.videos ?? []) {
      const match = video?.uri?.match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/)
      const videoId = match?.[1] ?? match?.[2]
      if (videoId && !ids.includes(videoId)) ids.push(videoId)
    }
    if (ids.length > 0) break // videos tied to this exact release suffice
  }
  return ids.slice(0, VIDEO_CANDIDATE_CAP)
}

/** First candidate that is public + embeddable (one videos.list unit). */
async function firstPlayable(videoIds, ytKey) {
  if (videoIds.length === 0) return null
  const body = await getJson(
    `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoIds.join(',')}&key=${ytKey}`,
  )
  const statuses = new Map(
    (body?.items ?? []).map((item) => [item.id, item.status]),
  )
  for (const videoId of videoIds) {
    const status = statuses.get(videoId)
    if (status?.embeddable && status.privacyStatus === 'public') return videoId
  }
  return null
}

/** IA audio whose creator exact-matches an alias (two queries max). */
async function archiveItem(aliases) {
  const primary = aliases[0]
  const romanized = aliases.find(
    (alias) => normalizeName(alias) !== normalizeName(primary),
  )
  for (const queryName of romanized ? [primary, romanized] : [primary]) {
    const query = encodeURIComponent(
      `creator:"${queryName.replace(/"/g, '')}" AND mediatype:audio`,
    )
    const body = await getJson(
      `https://archive.org/advancedsearch.php?q=${query}&fl[]=identifier&fl[]=creator&rows=5&page=1&output=json`,
    )
    await sleep(ARCHIVE_DELAY_MS)
    for (const doc of body?.response?.docs ?? []) {
      if (!doc?.identifier) continue
      const creators = Array.isArray(doc.creator)
        ? doc.creator
        : doc.creator
          ? [doc.creator]
          : []
      const matched = creators.some((creator) =>
        aliases.some(
          (alias) =>
            normalizeName(creator) &&
            normalizeName(creator) === normalizeName(alias),
        ),
      )
      if (matched) return `https://archive.org/details/${doc.identifier}`
    }
  }
  return null
}

function loadWork() {
  return existsSync(WORK_PATH)
    ? JSON.parse(readFileSync(WORK_PATH, 'utf8'))
    : { entries: {} }
}

function assemble(work) {
  const entries = {}
  for (const [key, entry] of Object.entries(work.entries)) {
    entries[key] = {
      play: entry.play,
      ...(entry.resolvedArtistId
        ? { resolvedArtistId: entry.resolvedArtistId }
        : {}),
    }
  }
  writeFileSync(
    OUT_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), entries }, null, 1)}\n`,
  )
  const total = Object.keys(entries).length
  const withPlay = Object.values(entries).filter((e) => e.play).length
  log(`assembled ${OUT_PATH}: ${total} entries, ${withPlay} with play`)
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
  const work = loadWork()

  if (process.argv.includes('--assemble')) {
    assemble(work)
    return
  }

  const token = env('DISCOGS_TOKEN')
  const ytKey = env('YOUTUBE_API_KEY')
  if (!token || !ytKey) {
    throw new Error('DISCOGS_TOKEN and YOUTUBE_API_KEY required (.env.local)')
  }

  const artists = Object.entries(dataset.countries).flatMap(([country, list]) =>
    list.map((artist) => ({ ...artist, country })),
  )
  log(`sweep start: ${artists.length} artists, ${Object.keys(work.entries).length} already done`)

  let done = 0
  for (const artist of artists) {
    const key = extraPlayKey(artist)
    if (work.entries[key]) continue

    const aliases = await buildAliases(artist)
    const nativeId = artist.discogsArtistId ?? null
    const recoveredId = nativeId
      ? null
      : await recoverDiscogsId(aliases, token)
    const discogsId = nativeId ?? recoveredId

    let play = null
    let via = null
    if (discogsId) {
      const candidates = await discogsReleaseVideoIds(discogsId, token)
      const videoId = await firstPlayable(candidates, ytKey)
      if (videoId) {
        play = {
          kind: 'youtube-video',
          url: `https://www.youtube.com/watch?v=${videoId}`,
        }
        via = 'discogs-videos'
      }
    }
    if (!play) {
      const archiveUrl = await archiveItem(aliases)
      if (archiveUrl) {
        play = { kind: 'archive', url: archiveUrl }
        via = 'archive'
      }
    }

    work.entries[key] = {
      name: artist.name,
      country: artist.country,
      play,
      via,
      ...(recoveredId ? { resolvedArtistId: recoveredId } : {}),
      checkedAt: new Date().toISOString(),
    }
    writeFileSync(WORK_PATH, JSON.stringify(work, null, 1))
    done += 1
    log(
      `${artist.country} ${artist.name} -> ${play ? `${via}: ${play.url}` : 'nothing verified'}${recoveredId ? ` (recovered dg:${recoveredId})` : ''}`,
    )
  }

  assemble(work)
  const values = Object.values(work.entries)
  log(
    `sweep done: ${values.length} artists | discogs-videos ${values.filter((e) => e.via === 'discogs-videos').length} | archive ${values.filter((e) => e.via === 'archive').length} | nothing ${values.filter((e) => !e.play).length} | recovered ids ${values.filter((e) => e.resolvedArtistId).length}`,
  )
  console.log(`processed this run: ${done}`)
}

main().catch((error) => {
  log(`FATAL: ${error.message}`)
  process.exit(1)
})
