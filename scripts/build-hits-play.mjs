/**
 * #1 hits verified-play sweep (owner GO Aug 20, 2026; channel rulings
 * Aug 21, 2026).
 *
 *   node scripts/build-hits-play.mjs                  # cheap pass
 *   node scripts/build-hits-play.mjs --phase search   # channel-scoped search
 *   node scripts/build-hits-play.mjs --assemble       # work file → lib JSON
 *
 * THE RULES (owner-set, no deviation):
 *   - EXACT normalized title equality. No fuzzy, ever.
 *   - videos.list playability gate (public + embeddable) on everything.
 *   - A channel may be SEARCHED once it is known (identity is fixed by
 *     the channelId parameter, so a wrong artist is structurally
 *     impossible) — but a channel is NEVER DISCOVERED BY NAME.
 *     "<Artist> - Topic" as a query is name matching in a costume.
 *   - A miss is an honest null: the row keeps its verified chart fact
 *     and simply carries no ▶.
 *
 * IDENTITY (the John Mayer rule, Aug 9 2026): a credited name is never
 * enough. A candidate is CONFIRMED only when the chart title appears in
 * that MBID's OWN release groups. Two candidates corroborating the same
 * title is an ambiguity, and ambiguity resolves to null, never a guess.
 *
 * CHANNEL DISCOVERY — evidence only, in order (owner ruling Aug 21):
 *   1. roster    — the artist's committed channelId (MBID-anchored)
 *   2. mb-rel    — the confirmed MBID's own MusicBrainz url-rel
 *   3. wikidata  — P2397 "YouTube channel ID" on the Q-id that MB itself
 *                  links from the confirmed MBID (verified Aug 21: label
 *                  "YouTube channel ID", empirically Q1299 → UCc4K7…)
 *   4. mb-recording — a YouTube url-rel on a RECORDING in the confirmed
 *                  artist's own catalog: the video is evidence, and its
 *                  channelId is that artist's channel by association.
 *   None of the above = the artist has no channel. Honest null.
 *
 * TOPIC CHANNELS are a legitimate tier (owner ruling Aug 21): auto-
 * generated from official distribution, so the content is official by
 * construction. Ranked below the artist's own channel, above nothing —
 * and only ever reached through the evidence chain above.
 *
 * Cost: MusicBrainz + Wikidata free (1 req/1.1s); YouTube ~1 unit per
 * uploads page / playability check, 100 per channel-scoped search.
 * Zero Anthropic wallet. Resumable via data/hits-play-work.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const US_PATH = join(ROOT, 'lib', 'hits', 'number-ones-us.json')
const UK_PATH = join(ROOT, 'lib', 'hits', 'number-ones-uk.json')
const ROSTER_PATH = join(ROOT, 'lib', 'discover', 'roster.json')
const GAPFILL_PATH = join(ROOT, 'lib', 'explore', 'extra-artists.json')
const WORK_PATH = join(ROOT, 'data', 'hits-play-work.json')
const PLAY_OUT = join(ROOT, 'lib', 'hits', 'hits-play.json')
const LINKS_OUT = join(ROOT, 'lib', 'hits', 'hits-artists.json')
const REPORT_OUT = join(ROOT, 'data', 'hits-play-report.json')
const RULINGS_PATH = join(ROOT, 'lib', 'hits', 'identity-rulings.json')

const UA = 'EarClefHitsPlay/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const MB_DELAY_MS = 1100
const WD_DELAY_MS = 400
/**
 * Uploads pages (of 50) per channel. Paging stops naturally at
 * nextPageToken, so ordinary channels cost what they cost; this cap
 * only bounds the giants. Measured Aug 21: full scans of every
 * over-500 channel cost ~350 units total, and the uploads playlist is
 * newest-first, so a 1960s single sits at the very END.
 */
const UPLOAD_PAGES = 60
/** MB name-search candidates considered before declaring ambiguity. */
const CANDIDATE_CAP = 4
/** Recording candidates inspected per missed title (free, MB-side). */
const RECORDING_CAP = 3
const SEARCH_COST = 100
/**
 * A song is not nine seconds long. Exact-title matching verifies the
 * NAME of a thing, never WHAT it is — a Short, a trailer and the record
 * all carry the same title (standing lesson, Aug 22 2026). Floor kills
 * Shorts and clips; no ceiling, because official videos legitimately run
 * long (Michael Jackson's "Black or White" is 11 minutes).
 */
const MIN_DURATION_SECONDS = 90
const DEFAULT_BUDGET = 8000
const DEFAULT_MINUTES = 420
/** Bump to force a re-pass over artists finished under older rules. */
const PASS = 4

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? Number(process.argv[index + 1]) : fallback
}
const flagOf = (flag) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : null
}
const BUDGET = argOf('--budget', DEFAULT_BUDGET)
const MINUTES = argOf('--minutes', DEFAULT_MINUTES)
const PHASE = flagOf('--phase') ?? 'cheap'
/** Sweep a single credited artist (normalized) — targeted verification. */
const ONLY = flagOf('--only')
const ASSEMBLE_ONLY = process.argv.includes('--assemble')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * Script-aware normalize (lesson 5): an empty result can only match
 * everything or nothing, so callers reject empties before comparing.
 */
const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** Joint-credit classes — REPORTING ONLY; linking never parses names. */
const EXPLICIT_JOINT =
  /\b(featuring|feat\.?|ft\.?|vs\.?|versus|with|presents|introducing|meets|duet with|starring)\b/i
const CONJUNCTION = /\s(?:&|and|\+|x)\s/i

const creditClass = (artist) =>
  EXPLICIT_JOINT.test(artist)
    ? 'explicit-joint'
    : CONJUNCTION.test(artist)
      ? 'conjunction-ambiguous'
      : 'single'

class QuotaError extends Error {}
let unitsSpent = 0

async function getJson(url, headers) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(12000),
      })
      if (res.status === 503 || res.status === 429) {
        await sleep(2000 * attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch (error) {
      if (attempt === 4) throw error
      await sleep(2000 * attempt)
    }
  }
  throw new Error('unreachable')
}

const mbJson = (url) => getJson(url, { 'User-Agent': UA })

async function ytJson(url, cost) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  unitsSpent += cost
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}))
    const reason = body?.error?.errors?.[0]?.reason ?? ''
    if (reason.includes('quota') || reason.includes('rateLimit')) {
      throw new QuotaError('YouTube daily quota exhausted')
    }
    throw new Error(`YouTube 403 (${reason})`)
  }
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`)
  return res.json()
}

function loadRows() {
  const rows = []
  for (const [country, path] of [
    ['US', US_PATH],
    ['GB', UK_PATH],
  ]) {
    const file = loadJson(path, null)
    if (!file) throw new Error(`${path} missing — run build-number-ones first`)
    for (const [year, block] of Object.entries(file.years)) {
      for (const entry of block.entries) {
        rows.push({
          country,
          year: Number(year),
          artist: entry.artist,
          title: entry.title,
          key: `${file.chart}|${entry.artist}|${entry.title}`,
        })
      }
    }
  }
  return rows
}

/**
 * Alias types that may stand in for a credited name (the site's Aug 8
 * 2026 rule: typed Artist/Legal names only — bot-added transliterations
 * and search hints are the Alexandra failure with better paperwork).
 */
const ALIAS_TYPES = new Set(['Artist name', 'Legal name'])

/**
 * MB artists whose NAME or TYPED ALIAS is exactly the credited name.
 * Fix 1 (owner-approved Aug 23, 2026): The Jackson 5 is filed as
 * "The Jacksons" with "The Jackson 5" as an alias, and the phrase query
 * artist:"The Jackson 5" returned ZERO results — the same wall that let
 * the band into Vietnam's gap-fill pool. Search is only candidate
 * GENERATION; exact normalized equality on name-or-typed-alias is the
 * gate, so a looser query cannot loosen identity.
 */
async function mbCandidates(artistName) {
  const wanted = normalize(artistName)
  if (!wanted) return []
  const quoted = artistName.replace(/"/g, '')
  const attempts = [
    `artist:"${quoted}" OR alias:"${quoted}"`,
    quoted, // unquoted fallback: Lucene tokenises some names oddly
  ]
  let artists = []
  for (const query of attempts) {
    const body = await mbJson(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&limit=12&fmt=json`,
    )
    await sleep(MB_DELAY_MS)
    artists = body.artists ?? []
    if (artists.length > 0) break
  }
  const matches = artists.filter((artist) => {
    if (normalize(artist.name) === wanted) return true
    return (artist.aliases ?? []).some(
      (alias) => ALIAS_TYPES.has(alias.type) && normalize(alias.name) === wanted,
    )
  })
  return matches.slice(0, CANDIDATE_CAP).map((artist) => ({
    mbid: artist.id,
    name: artist.name,
    begin: Number(artist['life-span']?.begin?.slice(0, 4)) || null,
    end: Number(artist['life-span']?.end?.slice(0, 4)) || null,
  }))
}

async function releaseGroupTitles(mbid) {
  const body = await mbJson(
    `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`,
  )
  await sleep(MB_DELAY_MS)
  return (body['release-groups'] ?? [])
    .map((group) => normalize(group.title))
    .filter(Boolean)
}

const videoIdOf = (url) => {
  const watch = url.match(/[?&]v=([0-9A-Za-z_-]{11})/)
  if (watch) return watch[1]
  const short = url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/)
  return short ? short[1] : null
}

/** MB url-rels on the confirmed artist: YouTube channel + Wikidata Q-id. */
async function artistRelations(mbid) {
  const body = await mbJson(
    `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`,
  )
  await sleep(MB_DELAY_MS)
  let youtube = null
  let wikidata = null
  for (const relation of body.relations ?? []) {
    const resource = relation.url?.resource
    if (!resource) continue
    try {
      const host = new URL(resource).hostname.replace(/^www\.|^m\./, '')
      if (host === 'youtube.com' && !youtube) youtube = resource
      if (host === 'wikidata.org' && !wikidata) {
        wikidata = resource.match(/(Q\d+)/)?.[1] ?? null
      }
    } catch {
      // Malformed URL in MB — skip.
    }
  }
  return { youtube, wikidata }
}

/**
 * Wikidata P2397 "YouTube channel ID" — reached only through the Q-id
 * MusicBrainz itself links from the confirmed MBID, so the chain stays
 * identity-anchored end to end (never a name lookup).
 */
async function wikidataChannel(qid) {
  const body = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P2397&format=json`,
    { 'User-Agent': UA },
  )
  await sleep(WD_DELAY_MS)
  for (const claim of body.claims?.P2397 ?? []) {
    const value = claim.mainsnak?.datavalue?.value
    if (typeof value === 'string' && /^UC[0-9A-Za-z_-]{22}$/.test(value)) {
      return value
    }
  }
  return null
}

/**
 * Recordings in this artist's OWN catalog whose title exactly matches.
 * Serves two purposes at once (owner-approved Aug 21): their EXISTENCE
 * corroborates that this MBID really recorded this title — completing
 * the John Mayer protection rather than weakening it, since the query
 * is anchored to `arid:` — and their url-rels may carry a video.
 *
 * Probed Aug 21: 23 of 24 unmatched Beatles titles were absent from
 * release-GROUP titles and were therefore written off without ever
 * being compared against the channel, yet 6 of 8 sampled exist as
 * recordings. Singles are frequently not release groups.
 */
async function recordingIdsFor(mbid, title) {
  return (await recordingsFor(mbid, title)).map((recording) => recording.id)
}

/**
 * Exact-title recordings in this artist's OWN catalog, each marked
 * STRONG or WEAK. Fix 2 (owner-approved Aug 23, 2026): "The Sweet" was
 * confirmed as a 2-track MB stub on the strength of ONE mis-credited
 * compilation recording. A recording that exists only on Various-
 * Artists compilations is somebody's filing decision, not the artist's
 * own release; confirmation requires at least one STRONG corroboration
 * — a release group of their own, or a recording on a non-compilation
 * release.
 */
async function recordingsFor(mbid, title) {
  const wanted = normalize(title)
  if (!wanted) return []
  const query = encodeURIComponent(
    `arid:${mbid} AND recording:"${title.replace(/"/g, '')}"`,
  )
  const body = await mbJson(
    `https://musicbrainz.org/ws/2/recording?query=${query}&limit=10&fmt=json`,
  )
  await sleep(MB_DELAY_MS)
  return (body.recordings ?? [])
    .filter((recording) => normalize(recording.title) === wanted)
    .slice(0, RECORDING_CAP)
    .map((recording) => ({
      id: recording.id,
      strong: (recording.releases ?? []).some((release) => {
        const types = release['release-group']?.['secondary-types'] ?? []
        return !types.includes('Compilation')
      }),
    }))
}

/** A YouTube video linked from one of those recordings, if any. */
async function recordingVideo(recordingIds) {
  for (const id of recordingIds) {
    const detail = await mbJson(
      `https://musicbrainz.org/ws/2/recording/${id}?inc=url-rels&fmt=json`,
    )
    await sleep(MB_DELAY_MS)
    for (const relation of detail.relations ?? []) {
      const resource = relation.url?.resource
      if (!resource) continue
      try {
        const host = new URL(resource).hostname.replace(/^www\.|^m\./, '')
        if (host === 'youtube.com' || host === 'youtu.be') {
          const videoId = videoIdOf(resource)
          if (videoId) return videoId
        }
      } catch {
        // Malformed URL in MB — skip.
      }
    }
  }
  return null
}

/**
 * A double A-side is TWO songs sharing one chart row ("Come Together /
 * Something"), so it corroborates and matches per side as well as whole.
 */
function titleSides(title) {
  const sides = String(title)
    .split(' / ')
    .map((side) => side.trim())
    .filter(Boolean)
  return sides.length > 1 ? [title, ...sides] : [title]
}

async function channelIdFromUrl(url, key) {
  const direct = url.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/)
  if (direct) return direct[1]
  const handle = url.match(/\/(@[^/?]+)/)
  const user = url.match(/\/user\/([^/?]+)/)
  const param = handle
    ? `forHandle=${encodeURIComponent(handle[1])}`
    : user
      ? `forUsername=${encodeURIComponent(user[1])}`
      : null
  if (!param) return null
  const body = await ytJson(
    `https://www.googleapis.com/youtube/v3/channels?part=id&${param}&key=${key}`,
    1,
  )
  return body.items?.[0]?.id ?? null
}

async function channelUploads(channelId, key) {
  const playlist = `UU${channelId.slice(2)}`
  const uploads = []
  let channelTitle = ''
  let pageToken = ''
  for (let page = 0; page < UPLOAD_PAGES; page++) {
    const body = await ytJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlist}&maxResults=50${
        pageToken ? `&pageToken=${pageToken}` : ''
      }&key=${key}`,
      1,
    )
    for (const item of body.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      channelTitle ||= item.snippet?.channelTitle ?? ''
      if (videoId && title) {
        uploads.push({ videoId, title: decodeEntities(title) })
      }
    }
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }
  return { uploads, channelTitle }
}

/**
 * Search WITHIN a known channel (owner ruling Aug 21). Identity is
 * fixed by the channelId parameter — results cannot come from another
 * artist — so the only remaining test is exact title equality.
 */
async function searchInChannel(channelId, title, artistName, key) {
  const body = await ytJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelId=${channelId}&maxResults=10&q=${encodeURIComponent(
      title,
    )}&key=${key}`,
    SEARCH_COST,
  )
  const uploads = (body.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId
    const raw = item.snippet?.title
    return videoId && raw ? [{ videoId, title: decodeEntities(raw) }] : []
  })
  return matchUpload(uploads, artistName, title)
}

/** part=status,snippet: playability AND the owning channel, 1 unit. */
async function videoFacts(videoId, key) {
  const body = await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?part=status,snippet,contentDetails&id=${videoId}&key=${key}`,
    1,
  )
  const item = body.items?.[0]
  if (!item) return null
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(
    item.contentDetails?.duration ?? '',
  )
  const [hours, minutes, seconds] = match
    ? match.slice(1).map((part) => Number(part ?? 0))
    : [0, 0, 0]
  const duration = hours * 3600 + minutes * 60 + seconds
  return {
    playable:
      Boolean(item.status?.embeddable && item.status.privacyStatus === 'public') &&
      duration >= MIN_DURATION_SECONDS,
    duration,
    channelId: item.snippet?.channelId ?? null,
    channelTitle: item.snippet?.channelTitle ?? '',
    title: item.snippet?.title ?? '',
  }
}

/**
 * Live-version detection, scoped to the ANNOTATION only (owner ruling
 * Aug 21, 2026: prefer studio, accept live, label it honestly).
 *
 * The marker is tested against what is left of the upload title after
 * the charting title is removed — never the whole string. That is what
 * makes it safe: "Live and Let Die (Official Video)" keeps "Live" in
 * the MATCHED portion, so its annotation reads "(Official Video)" and
 * it is correctly studio. Without this scoping a bare /live/ test would
 * mislabel every song whose own title contains the word.
 *
 * KNOWN RESIDUAL ERROR (reported to owner before building): a live
 * recording uploaded with NO annotation is indistinguishable from the
 * studio record and will be treated as studio. False positives are
 * near zero; false negatives are this case.
 */
const LIVE_MARKERS =
  /\b(live|unplugged|concert|en vivo|en directo|live lounge|bbc session|session at|acoustic session|tour)\b/i

/**
 * Annotations that change WHAT the upload is, not merely how it is
 * labelled. Stripping "(Official Video)" to compare titles is right;
 * stripping "(Behind The Scenes)" is how a making-of became a #1 hit's
 * play button. Tested against the annotation only, so a song whose own
 * title contains one of these words is unaffected.
 */
const NON_SONG_MARKERS =
  /\b(trailer|teaser|behind the scenes|making of|documentary|interview|preview|snippet|clip|reaction|announcement|album sampler)\b/i

function annotationOf(uploadTitle, chartTitle, artistName) {
  const upload = normalize(uploadTitle)
  const title = normalize(chartTitle)
  const artist = normalize(artistName)
  if (!upload || !title) return ''
  let rest = upload
  if (artist && rest.startsWith(`${artist} `)) rest = rest.slice(artist.length).trim()
  const at = rest.indexOf(title)
  if (at === -1) return rest
  return `${rest.slice(0, at)} ${rest.slice(at + title.length)}`.trim()
}

function isLiveUpload(uploadTitle, chartTitle, artistName) {
  const annotation = annotationOf(uploadTitle, chartTitle, artistName)
  return annotation ? LIVE_MARKERS.test(annotation) : false
}

function isNonSongUpload(uploadTitle, chartTitle, artistName) {
  const annotation = annotationOf(uploadTitle, chartTitle, artistName)
  return annotation ? NON_SONG_MARKERS.test(annotation) : false
}

/**
 * EXACT title equality, after stripping an "Artist - " prefix and
 * trailing production tags ("(Official Video)", "[Remastered]").
 * Stripping decoration is not fuzzy matching — what remains must match
 * exactly, character for character once normalized.
 */
function matchUpload(uploads, artistName, wantedTitle) {
  const wanted = normalize(wantedTitle)
  const artist = normalize(artistName)
  if (!wanted) return null
  const matches = []
  for (const upload of uploads) {
    const bare = upload.title
      .replace(/\([^()]*\)\s*$/g, '')
      .replace(/\[[^\][]*\]\s*$/g, '')
      .trim()
    const candidates = new Set([normalize(upload.title), normalize(bare)])
    if (artist) {
      for (const value of [upload.title, bare]) {
        const stripped = normalize(value)
        if (stripped.startsWith(`${artist} `)) {
          candidates.add(stripped.slice(artist.length).trim())
        }
      }
    }
    candidates.delete('')
    if (candidates.has(wanted)) {
      // The title matches, but a making-of is not the record.
      if (isNonSongUpload(upload.title, wantedTitle, artistName)) continue
      matches.push({
        ...upload,
        live: isLiveUpload(upload.title, wantedTitle, artistName),
      })
    }
  }
  if (matches.length === 0) return null
  // Prefer the studio recording; fall back to a live one rather than
  // leaving the row silent — hearing the song beats an empty row.
  return matches.find((match) => !match.live) ?? matches[0]
}

const saveWork = (work) => writeFileSync(WORK_PATH, JSON.stringify(work))

const dedupe = (items) => {
  const seen = new Set()
  return items.filter((item) => {
    const signature = JSON.stringify(item)
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

function assemble(work, rows) {
  const play = {}
  for (const [key, value] of Object.entries(work.verified)) {
    if (!value?.videoId) continue
    // Derived from the STORED upload title, so rows verified under an
    // earlier pass are labelled correctly without re-sweeping them.
    const chartTitle = key.split('|').slice(2).join('|')
    const credit = key.split('|')[1] ?? ''
    const live =
      value.live ?? isLiveUpload(value.title ?? '', chartTitle, credit)
    play[key] = live
      ? { videoId: value.videoId, live: true }
      : { videoId: value.videoId }
  }
  const links = {}
  for (const [name, artist] of Object.entries(work.artists)) {
    if (artist.rosterSlug) {
      links[name] = { slug: artist.rosterSlug, name: artist.rosterName }
    }
  }
  writeFileSync(PLAY_OUT, JSON.stringify(play))
  writeFileSync(LINKS_OUT, JSON.stringify(links))

  const swept = Object.values(work.artists)
  const resolved = swept.filter((artist) => artist.mbid)
  const channelSources = {}
  const channelKinds = {}
  for (const artist of resolved) {
    if (!artist.channelId) continue
    channelSources[artist.channelSource ?? 'unknown'] =
      (channelSources[artist.channelSource ?? 'unknown'] ?? 0) + 1
    channelKinds[artist.channelKind ?? 'unknown'] =
      (channelKinds[artist.channelKind ?? 'unknown'] ?? 0) + 1
  }
  const bySource = {}
  for (const value of Object.values(work.verified)) {
    if (!value?.videoId) continue
    bySource[value.via ?? 'unknown'] = (bySource[value.via ?? 'unknown'] ?? 0) + 1
  }

  const classes = { 'explicit-joint': 0, 'conjunction-ambiguous': 0, single: 0 }
  let withVideo = 0
  let linked = 0
  for (const row of rows) {
    classes[creditClass(row.artist)]++
    if (play[row.key]) withVideo++
    if (links[normalize(row.artist)]) linked++
  }
  const attempted = Object.keys(work.verified).length
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    rows: rows.length,
    uniqueKeys: new Set(rows.map((row) => row.key)).size,
    funnel: {
      artistsSwept: swept.length,
      identityConfirmed: resolved.length,
      identityUnconfirmed: swept.length - resolved.length,
      confirmedWithChannel: resolved.filter((a) => a.channelId).length,
      confirmedWithoutChannel: resolved.filter((a) => !a.channelId).length,
    },
    channelDiscovery: channelSources,
    channelKinds,
    verifiedVia: bySource,
    keysAttempted: attempted,
    verifiedVideos: Object.keys(play).length,
    rowsWithVideo: withVideo,
    matchRate: attempted
      ? `${((Object.keys(play).length / attempted) * 100).toFixed(1)}%`
      : 'n/a',
    creditClasses: classes,
    rowsLinkedToRoster: linked,
    rosterArtistsLinked: Object.keys(links).length,
    pendingChannelSearches: (work.searchQueue ?? []).length,
    // Fix 5: these lists accumulate across passes — dedupe by content
    // so a re-swept artist is not reported twice.
    gapFillCandidatesForOwnerReview: dedupe(work.gapFillCandidates ?? []),
    ambiguousIdentities: dedupe(work.ambiguous ?? []),
  }
  writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2))
  return report
}

/**
 * Per-row identity (fix 3, owner-approved Aug 23, 2026). A credited name
 * is not an artist: "Sweet Sensation" is a British soul group in 1974
 * and a Puerto Rican freestyle trio in 1990, one #1 each. So identity
 * resolves per (credit, chart row):
 *   1. an owner ruling for this credit (+ year) decides outright;
 *   2. candidates need STRONG corroboration for the row (fix 2);
 *   3. a candidate whose KNOWN lifespan excludes the chart year is out —
 *      an unknown lifespan never eliminates (lesson 5: absent decides
 *      nothing);
 *   4. if one survivor has a catalogue and the others none, it wins;
 *   5. anything still tied is ambiguous → null + report, never a guess.
 */
function resolveRowIdentity(row, candidates, rulings) {
  const ruled = rulings.find(
    (ruling) =>
      normalize(ruling.credit) === normalize(row.artist) &&
      (!ruling.years || ruling.years.includes(row.year)),
  )
  if (ruled) return { mbid: ruled.mbid, via: 'ruling' }

  const strong = candidates.filter((candidate) =>
    candidate.strongKeys.has(row.key),
  )
  if (strong.length === 0) return null
  if (strong.length === 1) return { mbid: strong[0].mbid, via: 'sole' }

  const alive = strong.filter(
    (candidate) =>
      !(candidate.begin && candidate.begin > row.year) &&
      !(candidate.end && candidate.end < row.year),
  )
  if (alive.length === 1) return { mbid: alive[0].mbid, via: 'lifespan' }

  const pool = alive.length > 0 ? alive : strong
  const withCatalogue = pool.filter((candidate) => candidate.rgCount > 0)
  if (withCatalogue.length === 1) {
    return { mbid: withCatalogue[0].mbid, via: 'catalogue' }
  }
  return { ambiguous: pool.map((candidate) => candidate.mbid) }
}

async function discoverChannel(mbid, rosterMatch, key) {
  if (rosterMatch?.channelId) {
    return { channelId: rosterMatch.channelId, channelSource: 'roster' }
  }
  const relations = await artistRelations(mbid)
  if (relations.youtube) {
    const channelId = await channelIdFromUrl(relations.youtube, key)
    if (channelId) return { channelId, channelSource: 'mb-rel' }
  }
  if (relations.wikidata) {
    const channelId = await wikidataChannel(relations.wikidata)
    if (channelId) return { channelId, channelSource: 'wikidata' }
  }
  return { channelId: null, channelSource: null }
}

async function sweepArtist(name, group, context) {
  const { key, rosterByName, rosterByMbid, gapByName, work, rulings } = context
  const record = {
    done: true,
    pass: PASS,
    mbid: null,
    channelId: null,
    channelSource: null,
    channelKind: null,
    identities: {},
  }

  // 1. Candidate generation: roster's committed MBID, owner rulings, and
  //    exact name-or-typed-alias MB matches. Generation is loose on
  //    purpose — the gates below are what decide.
  const rosterEntry = rosterByName.get(name)
  const ruledMbids = rulings
    .filter((ruling) => normalize(ruling.credit) === name)
    .map((ruling) => ruling.mbid)
  const seeds = new Map()
  if (rosterEntry?.mbid) {
    seeds.set(rosterEntry.mbid, { mbid: rosterEntry.mbid, name: rosterEntry.name })
  }
  for (const mbid of ruledMbids) seeds.set(mbid, { mbid, name: group.display })
  if (seeds.size === 0) {
    for (const candidate of await mbCandidates(group.display)) {
      seeds.set(candidate.mbid, candidate)
    }
  }
  if (seeds.size === 0) return record

  // 2. Corroborate every candidate against its OWN catalogue, recording
  //    strength per row. Release groups are strong by definition; a
  //    recording is strong only off a non-compilation release.
  const candidates = []
  for (const seed of seeds.values()) {
    const titles = await releaseGroupTitles(seed.mbid)
    const strongKeys = new Set()
    const weakKeys = new Set()
    const recordingIds = new Map()
    for (const row of group.rows) {
      const sides = titleSides(row.title)
      if (sides.some((side) => titles.includes(normalize(side)))) {
        strongKeys.add(row.key)
        continue
      }
      for (const side of sides) {
        const recordings = await recordingsFor(seed.mbid, side)
        if (recordings.length === 0) continue
        recordingIds.set(row.key, recordings.map((recording) => recording.id))
        if (recordings.some((recording) => recording.strong)) {
          strongKeys.add(row.key)
        } else {
          weakKeys.add(row.key)
        }
        break
      }
    }
    if (strongKeys.size + weakKeys.size === 0 && !ruledMbids.includes(seed.mbid)) {
      continue
    }
    candidates.push({
      ...seed,
      rgCount: titles.length,
      strongKeys,
      weakKeys,
      recordingIds,
    })
  }
  if (candidates.length === 0) return record

  // 3. Identity per row.
  const rowsByMbid = new Map()
  for (const row of group.rows) {
    const resolved = resolveRowIdentity(row, candidates, rulings)
    if (!resolved) {
      work.verified[row.key] ??= null
      continue
    }
    if (resolved.ambiguous) {
      work.ambiguous.push({
        credit: group.display,
        title: row.title,
        year: row.year,
        mbids: resolved.ambiguous,
      })
      work.verified[row.key] ??= null
      continue
    }
    if (!rowsByMbid.has(resolved.mbid)) rowsByMbid.set(resolved.mbid, [])
    rowsByMbid.get(resolved.mbid).push(row)
  }
  if (rowsByMbid.size === 0) return record

  // The credit's primary identity = the MBID covering the most rows
  // (roster links and gap-fill reporting key off the credit).
  const primary = [...rowsByMbid.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0][0]
  record.mbid = primary
  const primaryRoster = rosterByMbid.get(primary)
  if (primaryRoster && rowsByMbid.size === 1) {
    record.rosterSlug = primaryRoster.slug
    record.rosterName = primaryRoster.name
  }

  // Gap-fill: reported for owner review only — joining a gap-fill entry
  // to a chart credit needs name equality, which discovery may not use.
  const gap = gapByName.get(name)
  if (gap && !record.rosterSlug) {
    const overlaps = group.rows.some(
      (row) =>
        (!gap.firstYear || row.year >= gap.firstYear - 5) &&
        (!gap.lastYear || row.year <= gap.lastYear + 5),
    )
    if (overlaps) {
      work.gapFillCandidates.push({
        credit: group.display,
        country: gap.country,
        discogsArtistId: gap.discogsArtistId ?? null,
      })
    }
  }

  // 4. Per identity: channel discovery, uploads scan, exact match with
  //    studio preference, playability — then recording url-rels for the
  //    misses.
  for (const [mbid, rows] of rowsByMbid) {
    const candidate = candidates.find((entry) => entry.mbid === mbid)
    const identity = await discoverChannel(mbid, rosterByMbid.get(mbid), key)
    identity.channelKind = null
    identity.rows = rows.map((row) => row.key)
    let uploads = []
    if (identity.channelId) {
      const scan = await channelUploads(identity.channelId, key)
      uploads = scan.uploads
      identity.channelKind = /- topic$/i.test(scan.channelTitle.trim())
        ? 'topic'
        : 'own'
    }

    for (const row of rows) {
      if (work.verified[row.key]) continue

      let upload = null
      for (const side of titleSides(row.title)) {
        upload = matchUpload(uploads, group.display, side)
        if (upload && !upload.live) break
      }
      if (upload) {
        const facts = await videoFacts(upload.videoId, key)
        if (facts?.playable) {
          work.verified[row.key] = {
            videoId: upload.videoId,
            title: upload.title,
            via: 'uploads',
            live: Boolean(upload.live),
          }
          continue
        }
      }

      let ids = candidate?.recordingIds.get(row.key) ?? []
      if (ids.length === 0) {
        for (const side of titleSides(row.title)) {
          const found = await recordingIdsFor(mbid, side)
          if (found.length > 0) {
            ids = found
            break
          }
        }
      }
      const videoId = ids.length > 0 ? await recordingVideo(ids) : null
      if (!videoId) {
        work.verified[row.key] = null
        continue
      }
      const facts = await videoFacts(videoId, key)
      if (facts?.playable) {
        work.verified[row.key] = {
          videoId,
          title: row.title,
          via: 'mb-recording',
          live: isLiveUpload(facts.title, row.title, group.display),
        }
        if (!identity.channelId && facts.channelId) {
          identity.channelId = facts.channelId
          identity.channelSource = 'mb-recording'
          identity.channelKind = /- topic$/i.test(facts.channelTitle.trim())
            ? 'topic'
            : 'own'
        }
      } else {
        work.verified[row.key] = null
      }
    }
    record.identities[mbid] = identity
    if (mbid === primary) {
      record.channelId = identity.channelId
      record.channelSource = identity.channelSource
      record.channelKind = identity.channelKind
    }
  }

  for (const row of group.rows) {
    if (!(row.key in work.verified)) work.verified[row.key] = null
  }
  return record
}

/**
 * Re-match pass over rows that ALREADY carry a video (owner-approved
 * Aug 22, 2026), applying three things the original pass never had:
 * the duration floor, the non-song annotation blocklist, and the studio
 * preference (which landed after pass 3 had already picked first-match
 * -wins, so Bon Jovi's "Livin' on a Prayer" kept a Letterman take while
 * the studio upload sat on the same channel).
 *
 * YouTube only — no MusicBrainz — so it never competes with a sweep.
 * A row that can no longer be satisfied honestly goes back to null.
 */
async function runRematchPhase(work, rows, key, deadline) {
  const byArtist = new Map()
  for (const row of rows) {
    const name = normalize(row.artist)
    if (!name || !work.verified[row.key]?.videoId) continue
    if (!byArtist.has(name)) byArtist.set(name, { display: row.artist, rows: [] })
    byArtist.get(name).rows.push(row)
  }
  const pending = [...byArtist.entries()].filter(
    ([name]) => !work.rematched?.includes(name),
  )
  work.rematched ??= []
  console.log(`Re-match: ${pending.length} artists hold verified rows`)

  let dropped = 0
  let improved = 0
  let kept = 0
  for (const [name, group] of pending) {
    if (Date.now() > deadline || unitsSpent >= BUDGET) {
      console.log('— window/budget reached')
      break
    }
    const record = work.artists[name]
    try {
      let uploads = []
      if (record?.channelId) {
        const scan = await channelUploads(record.channelId, key)
        uploads = scan.uploads
      }
      for (const row of group.rows) {
        const current = work.verified[row.key]
        if (!current?.videoId) continue

        // Best available on the channel under the NEW rules.
        let best = null
        for (const side of titleSides(row.title)) {
          best = matchUpload(uploads, group.display, side)
          if (best && !best.live) break
        }
        if (best) {
          const facts = await videoFacts(best.videoId, key)
          if (facts?.playable) {
            const changed = best.videoId !== current.videoId
            work.verified[row.key] = {
              videoId: best.videoId,
              title: best.title,
              via: 'uploads',
              live: Boolean(best.live),
            }
            if (changed) improved++
            else kept++
            continue
          }
        }

        // No acceptable channel match — does the CURRENT pick still
        // pass the new filters on its own merits?
        const facts = await videoFacts(current.videoId, key)
        const nonSong =
          facts && isNonSongUpload(facts.title, row.title, group.display)
        if (facts?.playable && !nonSong) {
          work.verified[row.key] = {
            ...current,
            live: current.live ?? isLiveUpload(facts.title, row.title, group.display),
          }
          kept++
        } else {
          work.verified[row.key] = null
          dropped++
        }
      }
      work.rematched.push(name)
      saveWork(work)
    } catch (error) {
      if (error instanceof QuotaError) {
        console.log(`— ${error.message}; checkpointing`)
        saveWork(work)
        break
      }
      console.warn(`  ${group.display}: ${error.message} (will retry)`)
    }
  }
  console.log(
    `Re-match done: ${kept} kept, ${improved} swapped to a better pick, ` +
      `${dropped} dropped to honest nulls`,
  )
}

async function main() {
  const rows = loadRows()
  const roster = loadJson(ROSTER_PATH, [])
  const rosterByName = new Map()
  for (const entry of roster) {
    const name = normalize(entry.name)
    if (name) rosterByName.set(name, entry)
  }
  const rosterByMbid = new Map(
    roster.filter((entry) => entry.mbid).map((entry) => [entry.mbid, entry]),
  )
  const gapFill = loadJson(GAPFILL_PATH, { countries: {} })
  const gapByName = new Map()
  for (const [country, entries] of Object.entries(gapFill.countries ?? {})) {
    for (const entry of entries) {
      const name = normalize(entry.name)
      if (name && !gapByName.has(name)) gapByName.set(name, { ...entry, country })
    }
  }

  // Guard against clobbering committed outputs: a work file that is
  // mid-write (the sweep saves after every artist) parses as null, and
  // assembling from an empty object would overwrite hits-play.json with
  // {}. Durable data outlives code — refuse rather than truncate.
  const existingWork = existsSync(WORK_PATH) ? loadJson(WORK_PATH, null) : null
  if (existsSync(WORK_PATH) && existingWork === null) {
    throw new Error(
      `${WORK_PATH} exists but is unreadable (sweep mid-write?) — refusing ` +
        'to assemble, which would truncate the committed outputs.',
    )
  }
  const work = existingWork ?? {
    version: 2,
    artists: {},
    verified: {},
    ambiguous: [],
    gapFillCandidates: [],
    searchQueue: [],
  }
  work.searchQueue ??= []
  work.ambiguous ??= []
  work.gapFillCandidates ??= []

  if (ASSEMBLE_ONLY) {
    console.log(JSON.stringify(assemble(work, rows), null, 2))
    return
  }

  const key = env('YOUTUBE_API_KEY')
  if (!key) throw new Error('YOUTUBE_API_KEY missing (.env.local)')
  const deadline = Date.now() + MINUTES * 60 * 1000

  if (PHASE === 'rematch') {
    await runRematchPhase(work, rows, key, deadline)
    saveWork(work)
    console.log(JSON.stringify(assemble(work, rows), null, 2))
    return
  }

  if (PHASE === 'search') {
    // ECONOMICS RULING (owner, Aug 21, 2026): the technique is approved
    // and stays here, but the phase is RETIRED — it cost ~700-800 units
    // per recovered video (5 found across ~40 searches) because MB
    // url-rels often name a legacy promo channel rather than where the
    // catalog lives. Searching harder cannot fix a wrong-address problem
    // when the cheap pass returns 43.8% for almost nothing. The 5 it
    // already found are kept. --force-search runs it anyway.
    if (!process.argv.includes('--force-search')) {
      console.log(
        'Search phase RETIRED by owner ruling (Aug 21, 2026) — ~700-800 ' +
          'units per video. Re-run with --force-search to override.',
      )
      return
    }
    await runSearchPhase(work, key, deadline)
    saveWork(work)
    console.log(JSON.stringify(assemble(work, rows), null, 2))
    return
  }

  const byArtist = new Map()
  for (const row of rows) {
    const name = normalize(row.artist)
    if (!name) continue
    if (!byArtist.has(name)) byArtist.set(name, { display: row.artist, rows: [] })
    byArtist.get(name).rows.push(row)
  }

  // Deterministic shuffle, NOT chart order: the corpus spans 1952–2026
  // and channel coverage varies hugely by era, so chart order would make
  // each night's match rate a statement about one decade.
  const orderHash = (value) => {
    let hash = 2166136261
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }
  const pending = [...byArtist.entries()]
    .filter(([name]) => !ONLY || name === normalize(ONLY))
    .filter(([name]) => ONLY || (work.artists[name]?.pass ?? 0) < PASS)
    .sort(([a], [b]) => orderHash(a) - orderHash(b))

  console.log(
    `${rows.length} rows · ${byArtist.size} credited artists · ` +
      `${pending.length} to sweep (pass ${PASS}) · ${BUDGET} units / ${MINUTES} min`,
  )

  const rulings = loadJson(RULINGS_PATH, { rulings: [] }).rulings
  const context = { key, rosterByName, rosterByMbid, gapByName, work, rulings }
  let swept = 0
  for (const [name, group] of pending) {
    if (Date.now() > deadline) {
      console.log('— window closed')
      break
    }
    if (unitsSpent >= BUDGET) {
      console.log('— quota budget reached')
      break
    }
    try {
      work.artists[name] = await sweepArtist(name, group, context)
    } catch (error) {
      if (error instanceof QuotaError) {
        console.log(`— ${error.message}; checkpointing`)
        saveWork(work)
        break
      }
      console.warn(`  ${group.display}: ${error.message} (will retry)`)
      saveWork(work)
      continue
    }
    swept++
    saveWork(work)
    if (swept % 25 === 0) {
      const hits = Object.values(work.verified).filter(Boolean).length
      console.log(
        `  [${swept}/${pending.length}] ${hits} verified · ${unitsSpent} units · ` +
          `last: ${group.display}`,
      )
    }
  }

  saveWork(work)
  console.log(`\nSwept ${swept} artists this run · ${unitsSpent} units`)
  console.log(JSON.stringify(assemble(work, rows), null, 2))
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
