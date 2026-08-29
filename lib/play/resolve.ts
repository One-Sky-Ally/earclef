/**
 * Server-side resolution chain for verified play destinations.
 *
 *   0. Already-resolved queue track (Netlify Blobs, playability-checked
 *      video ID) when a decade hint is available — free and strongest.
 *   1. MusicBrainz URL relationships: a direct video link, else
 *      Bandcamp → SoundCloud → the artist's YouTube channel. Every one
 *      is an artist-attached MB fact, not a guess. (The official-site
 *      kind is PULLED — Aug 29 phishing incident; see below.)
 *   2. Internet Archive audio whose creator actually matches the name.
 *   3. Streaming pages from the same MB relations (owner-approved Aug
 *      30, 2026): free services (Spotify/Deezer) before paid (Apple
 *      Music/Tidal/Amazon Music) — paid earns a ▶ only when no free
 *      option exists. Last because they open an app-gated page where
 *      everything above plays free and direct. Platform hosts cannot
 *      be domain-squatted, so the phishing class cannot recur here.
 *   4. Nothing — the caller renders no play button ("read about" only).
 *
 * Relative imports only: this module is bundled into the Netlify
 * background function, whose bundler doesn't read tsconfig paths.
 */
import { getStore } from '@netlify/blobs'
import type { ArtistPlay, PlayKind, PlayLink, ReadLink } from './types'

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

interface MbUrlRelation {
  type?: string
  url?: { resource?: string }
}

/**
 * Script-aware normalization (the gap-fill pool includes Lao, so an
 * ASCII-only squeeze would reduce names to '' and match everything).
 */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * EXACT equality only. Containment was tried first and produced the
 * "Alexandra" incident (Aug 8, 2026): an Internet Archive podcast
 * co-hosted by an "Alexandra Tobor" matched the mononym artist
 * "Alexandra" and earned a garbage play badge. Homonyms can still
 * collide, but exact matching is the same bar the MB verifier uses.
 */
function namesMatch(a: string, b: string): boolean {
  const left = normalizeName(a)
  const right = normalizeName(b)
  if (!left || !right) return false
  return left === right
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Queue Blobs key, shared with the queue route. Names the old
 * ASCII-only normalize reduced to '' could cache garbage search hits
 * (empty-string equality — the Alexandra failure class), so that
 * class lives in a fresh v2 keyspace; Latin-name entries stay cached.
 */
export function queueCacheKey(
  mbid: string,
  decade: string,
  name: string,
): string {
  const legacyEmptyName =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '') === ''
  return `${legacyEmptyName ? 'v2/' : ''}artist/${mbid}/${decade}`
}

/** Step 0: a queue-resolved, playability-checked video for this era. */
async function queueCachedVideo(
  mbid: string,
  decade: string | null,
  name: string,
): Promise<PlayLink | null> {
  if (!decade) return null
  try {
    const cached = (await getStore({
      name: 'queue',
      consistency: 'eventual',
    }).get(queueCacheKey(mbid, decade, name), { type: 'json' })) as {
      track?: {
        videoId?: string
        source?: string
        corroborated?: boolean
      } | null
    } | null
    const track = cached?.track
    // Same purge rule as the queue route (John Mayer, Aug 9 2026):
    // pre-rule search-sourced tracks were identity-by-bare-name and
    // must never feed a ▶; channel/corroborated entries stand.
    if (track?.source === 'search' && !track.corroborated) return null
    const videoId = track?.videoId
    return videoId
      ? { kind: 'youtube-video', url: `https://www.youtube.com/watch?v=${videoId}` }
      : null
  } catch {
    return null // no Blobs context (dev) — the chain continues
  }
}

interface ClassifiedRels {
  play: PlayLink | null
  wikipedia: string | null
  /** Streaming pages found on the artist, free services first. */
  streaming: PlayLink[]
}

/**
 * Streaming hosts, classified by DOMAIN like everything else here
 * (MB's 'free streaming'/'streaming' typing varies by editor; the
 * host names the service, and free-vs-paid is a fact about the
 * service — FREE_STREAMING_KINDS). itunes.apple.com is deliberately
 * absent: 'purchase for download' is a shop, not a play.
 */
function streamingKindOf(host: string): PlayKind | null {
  if (host === 'open.spotify.com') return 'spotify'
  if (host === 'deezer.com' || host.endsWith('.deezer.com')) return 'deezer'
  if (host === 'music.apple.com') return 'apple-music'
  if (host === 'tidal.com' || host === 'listen.tidal.com') return 'tidal'
  if (host === 'music.amazon.com' || /^music\.amazon\.[a-z.]+$/.test(host)) {
    return 'amazon-music'
  }
  return null
}

/**
 * Classify MB url-rels by DOMAIN (types vary; hostnames don't lie).
 * Priority: direct video > Bandcamp > SoundCloud > channel > official.
 */
function classifyRelations(relations: MbUrlRelation[]): ClassifiedRels {
  const found: Partial<Record<PlayLink['kind'], string>> = {}
  let wikipedia: string | null = null
  for (const relation of relations) {
    const resource = relation.url?.resource
    if (!resource) continue
    let parsed: URL
    try {
      parsed = new URL(resource)
    } catch {
      continue
    }
    const host = parsed.hostname.replace(/^www\./, '')
    if (
      (host === 'youtube.com' || host === 'm.youtube.com') &&
      parsed.pathname.startsWith('/watch')
    ) {
      found['youtube-video'] ??= resource
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      found['youtube-channel'] ??= resource
    } else if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) {
      found.bandcamp ??= resource
    } else if (host === 'soundcloud.com') {
      found.soundcloud ??= resource
    } else if (host.endsWith('.wikipedia.org')) {
      wikipedia ??= resource
    } else if (relation.type === 'official homepage') {
      found.official ??= resource
    } else {
      const streamingKind = streamingKindOf(host)
      if (streamingKind) found[streamingKind] ??= resource
    }
  }
  // 'official' PULLED from the chain (Aug 29 2026, user-safety
  // incident): Nawang Khechog's expired official-homepage domain was
  // repurchased and served phishing through a live 200 — the one case
  // isParkedOrDead() structurally cannot catch (it answers "is it
  // alive?", not "is it safe?"; flagged Aug 10, Mohamed Fouad). An
  // expired domain class with no safety oracle earns no ▶. Officials
  // may return only behind an owner-ruled allowlist.
  // Free services first (owner ruling, Aug 30 2026; the free set is
  // FREE_STREAMING_KINDS in ./types): paid streaming earns a ▶ only
  // when no free option exists for the artist, so the fallback pick —
  // streaming[0] — must always be the freest thing found.
  const streamingOrder: PlayKind[] = [
    'spotify',
    'deezer',
    'apple-music',
    'tidal',
    'amazon-music',
  ]
  const streaming = streamingOrder.flatMap((kind) => {
    const url = found[kind]
    return url ? [{ kind, url }] : []
  })
  const order: PlayLink['kind'][] = [
    'youtube-video',
    'bandcamp',
    'soundcloud',
    'youtube-channel',
  ]
  for (const kind of order) {
    const url = found[kind]
    if (url) return { play: { kind, url }, wikipedia, streaming }
  }
  return { play: null, wikipedia, streaming }
}

/**
 * Parked/dead-domain gate for official-site play links (Salim Dada
 * incident, Aug 9 2026: an MB 'official homepage' rel pointed at a
 * GoDaddy for-sale lander). High-precision markers only; any network
 * failure also disqualifies — a ▶ must lead somewhere real.
 */
const PARKING_HOSTS =
  /forsale\.godaddy|sedo(parking)?\.com|afternic\.com|dan\.com|hugedomains\.com|parkingcrew|bodis\.com|above\.com|undeveloped\.com/i
const PARKING_BODY_MARKERS = [
  'window.location.href="/lander"',
  "window.location.href='/lander'",
  'sedoparking.com',
  'parkingcrew',
  'This domain may be for sale',
  'domain is for sale',
]

export async function isParkedOrDead(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return true
    if (PARKING_HOSTS.test(res.url)) return true
    const reader = res.body?.getReader()
    if (!reader) return false
    const { value } = await reader.read()
    await reader.cancel()
    const head = new TextDecoder()
      .decode(value ?? new Uint8Array())
      .slice(0, 4096)
    return PARKING_BODY_MARKERS.some((marker) => head.includes(marker))
  } catch {
    return true // unreachable = dead; no ▶
  }
}

/**
 * Step 2: Internet Archive audio, only on a real creator match.
 * Takes the artist's full alias set (canonical name first): IA
 * catalogues non-Western artists under romanizations, so the search
 * runs on up to two distinct spellings and a creator must EXACT-match
 * one of the aliases. More spellings, never looser matching.
 */
async function archiveAudioItem(aliases: string[]): Promise<PlayLink | null> {
  const primary = aliases[0]
  const romanized = aliases.find(
    (alias) => normalizeName(alias) !== normalizeName(primary),
  )
  const queries = romanized ? [primary, romanized] : [primary]
  for (const queryName of queries) {
    const query = encodeURIComponent(
      `creator:"${queryName.replace(/"/g, '')}" AND mediatype:audio`,
    )
    const body = (await fetchJson(
      `https://archive.org/advancedsearch.php?q=${query}&fl[]=identifier&fl[]=creator&rows=5&page=1&output=json`,
    )) as {
      response?: {
        docs?: { identifier?: string; creator?: string | string[] }[]
      }
    } | null
    for (const doc of body?.response?.docs ?? []) {
      if (!doc.identifier) continue
      const creators = Array.isArray(doc.creator)
        ? doc.creator
        : doc.creator
          ? [doc.creator]
          : []
      const matched = creators.some((creator) =>
        aliases.some((alias) => namesMatch(creator, alias)),
      )
      if (matched) {
        return {
          kind: 'archive',
          url: `https://archive.org/details/${doc.identifier}`,
        }
      }
    }
  }
  return null
}

/** Full chain for a MusicBrainz artist. */
export async function resolveMbArtistPlay(
  mbid: string,
  decade: string | null,
): Promise<ArtistPlay> {
  const read: ReadLink = {
    kind: 'musicbrainz',
    url: `https://musicbrainz.org/artist/${mbid}`,
  }

  // MB first: the canonical name (needed for the queue cache key and
  // the IA search) and aliases ride the same url-rels call.
  const body = (await fetchJson(
    `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels+aliases&fmt=json`,
  )) as {
    name?: string
    aliases?: { name?: string; type?: string | null }[]
    relations?: MbUrlRelation[]
  } | null
  const rels = classifyRelations(body?.relations ?? [])
  const readLink: ReadLink = rels.wikipedia
    ? { kind: 'wikipedia', url: rels.wikipedia }
    : read

  const queued = body?.name
    ? await queueCachedVideo(mbid, decade, body.name)
    : null
  if (queued) return { play: queued, read: readLink }
  // Every remaining kind is platform-hosted (YouTube/Bandcamp/
  // SoundCloud) — the official-site kind is gone (Aug 29 incident).
  if (rels.play) return { play: rels.play, read: readLink }

  // Alias set: exact-match against every documented spelling (MB
  // aliases carry romanizations), never against similar strings —
  // more spellings, not looser matching. Only alias types "Artist
  // name" and "Legal name" count: untyped or search-hint aliases
  // include bot-added junk, and a false exact match from junk is the
  // Alexandra failure with better paperwork (owner ruling, Aug 8).
  const aliases = [
    ...(body?.name ? [body.name] : []),
    ...(body?.aliases ?? []).flatMap((alias) =>
      alias.name && (alias.type === 'Artist name' || alias.type === 'Legal name')
        ? [alias.name]
        : [],
    ),
  ]
  const archive = aliases.length > 0 ? await archiveAudioItem(aliases) : null
  if (archive) return { play: archive, read: readLink }

  // Step 3: streaming pages, already free-first from classifyRelations.
  // The full list ships so the client can swap in the fan's chosen
  // service at render time — the preference must never key the shared
  // 30-day cache (it would fragment it per service and multiply MB
  // load). Only the streaming FALLBACK carries the list: a verified
  // video/Bandcamp/archive play is never downgraded to an app page.
  if (rels.streaming.length > 0) {
    return {
      play: rels.streaming[0],
      read: readLink,
      streaming: rels.streaming,
    }
  }
  return { play: null, read: readLink }
}

/**
 * Chain for gap-fill artists (no MB record): Internet Archive only at
 * runtime. Discogs credits use "A = B" for the same artist in two
 * scripts, so '='-separated segments join the alias set; '/' credits
 * are JOINT credits (different artists) and never split.
 */
export async function resolveExtraArtistPlay(
  name: string,
  read: ReadLink,
): Promise<ArtistPlay> {
  const aliases = [
    name,
    ...name
      .split('=')
      .map((segment) => segment.replace(/\*\s*$/, '').trim())
      .filter((segment) => segment.length > 1),
  ].filter((alias, index, all) => all.indexOf(alias) === index)
  const archive = await archiveAudioItem(aliases)
  return { play: archive, read }
}
