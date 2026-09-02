import { NextResponse } from 'next/server'
import { getStore } from '@netlify/blobs'
import { queueCacheKey } from '@/lib/play/resolve'
import {
  annotationOf,
  isNonSongUpload,
  isSongLength,
  nonMusicVerdict,
} from '@/lib/play/contentGates'
import {
  RG_DATING_VERSION,
  rgDatingFor,
  type ArtistDating,
} from '@/lib/explore/rgDating'

/**
 * Play-queue resolver: ONE artist → their era-correct playable video.
 *
 * The place+era queue is a deterministic client-side walk of the
 * panel's popularity pool; this route does the per-artist work —
 * era-picking a track from MusicBrainz release-group dates, then
 * finding it on the artist's OWN channel (MB url-rels) or via one
 * capped YouTube search restricted to exact-channel-name / Topic
 * matches. Never invented: every candidate passes a videos.list
 * playability check (public + embeddable) before it ships.
 *
 * Results cache PERMANENTLY in Blobs (nulls retry after 30 days) and
 * ride a 30-day CDN header — an artist resolved for Jamaica's 1970s
 * serves every early-70s combo forever. Quota exhaustion is returned
 * as {quota:true} and never cached, so queues finish brewing on a
 * later day. Zero Anthropic wallet: MusicBrainz + YouTube only.
 */

const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DECADE = /^(19|20)\d0$/
const MB_DELAY_MS = 1100
/**
 * Upload pages (of 50) scanned on the artist's own channel. Raised
 * 2 → 4 with multi-track (Aug 31, 2026): the window, not the matching,
 * was the yield limit — a deep catalogue can't be found in 100 uploads.
 * Costs 1 unit per page and is SELF-TARGETING: the scan stops at the
 * last page, so small channels still cost 1-2 units and only prolific
 * ones pay 4 — exactly the artists with more songs to give.
 */
const UPLOAD_PAGES = 4
/**
 * Songs returned per artist, so a queue can keep playing without
 * re-resolving (owner-approved Aug 31, 2026: a listener on a sparse
 * place or a narrow genre filter must not hit a dead end).
 *
 * Depth is FREE on the channel path and the reason is worth stating:
 * the release-group call (100 groups) and the uploads scan (100
 * videos) already happened for track 1, and videos.list batch-checks
 * up to 50 ids for ONE unit — so twelve tracks cost less than today's
 * up-to-three sequential playability checks. What depth actually
 * spends is ERA-TRUTH: candidates are ranked in-era first, then
 * nearby, then plain catalog, and each track carries the `era` it
 * earned. The search path is NOT deepened — one search is 100 units
 * and its identity anchor is a single title (John Mayer rule).
 */
const MAX_TRACKS_PER_ARTIST = 12
/** Candidates playability-checked in one batched call (≤50 = 1 unit). */
const MAX_CANDIDATES = 24
/** Release-group titles matched against uploads, era-ranked. */
const MAX_TITLES = 40
const NULL_TTL_MS = 30 * 24 * 60 * 60 * 1000
/**
 * Rules version of the resolver that WROTE a cache entry. Bumping it
 * invalidates everything written under older rules — standing lesson
 * 2: fixing a generator does not fix what the generator already wrote.
 * 1 = content-gated (duration floor + non-song annotation markers).
 * 2 = multi-track (up to MAX_TRACKS_PER_ARTIST per artist).
 * 3 = non-music verdicts (television topic + description first line
 *     + widened title markers). Entries written under 1 or 2 were
 *     resolved BEFORE those checks existed, so the documentary that
 *     opened Jamaica 1961 sits in the cache under pass 2 and would be
 *     served forever without this bump.
 */
const GATE_PASS = 3

/** What videos.list tells us about a candidate beyond playability. */
interface VideoFacts {
  description?: string
  topicUrls?: string[]
}

export interface QueueTrack {
  videoId: string
  title: string
  /** 'channel' = artist's MB-linked channel; 'search' = verified search. */
  source: 'channel' | 'search'
  /** How era-true the pick is: in-era | nearby (±10y) | catalog. */
  era: 'in-era' | 'nearby' | 'catalog'
  /**
   * Search-sourced tracks written under the John Mayer rule (Aug 9,
   * 2026): the video title matched a release title from the MBID's
   * OWN catalog. Pre-rule search entries lack this flag and are
   * treated as cache misses — bare channel-name equality once served
   * the American guitarist for India's Indo-jazz composer.
   */
  corroborated?: boolean
  /**
   * The release-group title this pick was matched against. Stored so a
   * future rules change can re-run the annotation gate over cached
   * entries instead of re-deriving the era pick from MusicBrainz.
   */
  eraTitle?: string
}

interface CachedResolve {
  at: string
  /** The era-truest pick — kept for readers that want just one. */
  track: QueueTrack | null
  /** Every playable song found, era-ranked; tracks[0] === track. */
  tracks?: QueueTrack[]
  /** Resolver rules version; absent = pre-gate (see GATE_PASS). */
  pass?: number
  /**
   * Era-dating corrections version this entry was resolved under.
   * Only checked for artists that HAVE corrections — everyone else's
   * entries stay valid forever, which is what keeps a corrections
   * refresh from re-resolving thousands of untouched artists.
   */
  cv?: string
}

function store() {
  return getStore({ name: 'queue', consistency: 'eventual' })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** YouTube API titles arrive HTML-encoded; store them as plain text. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Script-aware: the ASCII-only version reduced non-Latin names AND
 * channel titles to '', and '' === '' passed the official-channel bar
 * — the empty-string cousin of the Alexandra fuzzy-match failure.
 */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

async function mbJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 503 || res.status === 429) {
      await sleep(1400 * attempt)
      continue
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
    return res.json()
  }
  throw new Error('MusicBrainz rate limited')
}

interface MbReleaseGroup {
  id?: string
  title?: string
  'first-release-date'?: string
  'primary-type'?: string
}

interface EraTitle {
  title: string
  era: QueueTrack['era']
}

/**
 * The era ranking: every release-group title this artist put out,
 * ordered by how era-true it is — in-era first (singles beat EPs beat
 * albums, closest to mid-decade), then work within ±15 years by
 * proximity, then undated catalog. Track 1 takes the head of this
 * list; the deeper entries are what let one artist contribute more
 * than one song, each carrying the era it actually earned.
 *
 * ERA-DATING CORRECTIONS (owner-approved Stage 4, Sep 1 2026 — "music
 * belongs to when it was created"):
 *
 * A title with a per-song correction ranks by its TRUE year — the
 * original recording — instead of MusicBrainz's first-release-date,
 * which for pre-digital catalogs is routinely a CD-era reissue (the
 * Uruguay-1996 bug: a 1964 tango ranked "nearby" for the 1990s off a
 * 2001 compilation date). A retrospective album with no per-song date
 * for a title ranks by the album's SPAN — a range, because a
 * compilation of 1950s-60s sides has no single true year.
 *
 * MOVE, DON'T COPY (owner ruling): a CORRECTED title outside the
 * in-era/nearby bands is DROPPED, not demoted to catalog — once a
 * record is known to be from 1964 it must no longer be reachable from
 * 1996. UNCORRECTED titles keep catalog-tier service untouched, so no
 * artist loses their last playable record to a correction; only the
 * false padding leaves.
 *
 * Live albums and re-recordings never appear in the corrections
 * dataset (excluded upstream by the arbitration rules), so their
 * MusicBrainz dates stand here without this function needing to know
 * why — absence is the verdict.
 */
function rankEraTitles(
  groups: MbReleaseGroup[],
  decade: number,
  dating: ArtistDating | null,
  titleKey: (value: string) => string,
): EraTitle[] {
  const mid = decade + 5
  const typeRank = (type: string) =>
    type === 'Single' ? 0 : type === 'EP' ? 1 : type === 'Album' ? 2 : 3
  interface Ranged {
    title: string
    lo: number
    hi: number
    type: string
    corrected: boolean
  }
  const dated: Ranged[] = []
  const undated: string[] = []
  for (const group of groups) {
    if (!group.title) continue
    const songYear = dating?.s[titleKey(group.title)]
    const albumSpan = group.id ? dating?.a[group.id] : undefined
    const mbYear = Number(group['first-release-date']?.slice(0, 4))
    if (songYear !== undefined) {
      dated.push({
        title: group.title,
        lo: songYear,
        hi: songYear,
        type: group['primary-type'] ?? '',
        corrected: true,
      })
    } else if (albumSpan !== undefined) {
      dated.push({
        title: group.title,
        lo: albumSpan[0],
        hi: albumSpan[1],
        type: group['primary-type'] ?? '',
        corrected: true,
      })
    } else if (Number.isFinite(mbYear)) {
      dated.push({
        title: group.title,
        lo: mbYear,
        hi: mbYear,
        type: group['primary-type'] ?? '',
        corrected: false,
      })
    } else {
      undated.push(group.title)
    }
  }
  /** Distance from mid-decade to the nearest edge of the range. */
  const distance = (g: Ranged) =>
    g.lo > mid ? g.lo - mid : g.hi < mid ? mid - g.hi : 0
  const inEra = dated
    .filter((g) => g.lo <= decade + 9 && g.hi >= decade)
    .sort(
      (a, b) => typeRank(a.type) - typeRank(b.type) || distance(a) - distance(b),
    )
  const nearby = dated
    .filter(
      (g) => !(g.lo <= decade + 9 && g.hi >= decade) && distance(g) <= 15,
    )
    .sort((a, b) => distance(a) - distance(b))
  const catalog = dated
    .filter((g) => distance(g) > 15 && !g.corrected)
    .sort((a, b) => distance(a) - distance(b))
  const ranked: EraTitle[] = [
    ...inEra.map((g) => ({ title: g.title, era: 'in-era' as const })),
    ...nearby.map((g) => ({ title: g.title, era: 'nearby' as const })),
    ...catalog.map((g) => ({ title: g.title, era: 'catalog' as const })),
    ...undated.map((title) => ({ title, era: 'catalog' as const })),
  ]
  // Same title can appear as single AND album — keep the era-truest.
  const seen = new Set<string>()
  return ranked
    .filter((entry) => {
      const key = titleKey(entry.title)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_TITLES)
}

/** The artist's MB-linked YouTube channel URL, if curated. */
function youtubeRel(
  relations: { url?: { resource?: string } }[] | undefined,
): string | null {
  for (const relation of relations ?? []) {
    const resource = relation.url?.resource
    if (!resource) continue
    try {
      const host = new URL(resource).hostname.replace(/^www\.|^m\./, '')
      if (host === 'youtube.com') return resource
    } catch {
      // Malformed URL in MB — skip.
    }
  }
  return null
}

class QuotaError extends Error {}

async function ytJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[] }
    }
    const reason = body.error?.errors?.[0]?.reason ?? ''
    if (reason.includes('quota') || reason.includes('rateLimit')) {
      throw new QuotaError()
    }
    throw new Error('YouTube 403')
  }
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`)
  return res.json()
}

/** Resolve a channel URL to its ID: free for /channel/UC…, 1 unit else. */
async function channelId(url: string, key: string): Promise<string | null> {
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
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/channels?part=id&${param}&key=${key}`,
  )) as { items?: { id?: string }[] }
  return body.items?.[0]?.id ?? null
}

interface Upload {
  videoId: string
  title: string
}

/** Uploads scan: 1 unit per page of 50 — the cheap path. */
async function channelUploads(id: string, key: string): Promise<Upload[]> {
  const playlist = `UU${id.slice(2)}`
  const uploads: Upload[] = []
  let pageToken = ''
  for (let page = 0; page < UPLOAD_PAGES; page++) {
    const body = (await ytJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlist}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}&key=${key}`,
    )) as {
      nextPageToken?: string
      items?: {
        snippet?: { title?: string; resourceId?: { videoId?: string } }
      }[]
    }
    for (const item of body.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      if (videoId && title) uploads.push({ videoId, title })
    }
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }
  return uploads
}

interface SearchHit {
  videoId: string
  title: string
  channelTitle: string
}

/**
 * The expensive fallback: ONE search (100 units), DOUBLY verified.
 * NO TITLE, NO SEARCH (owner ruling, Aug 9 2026): channel-name
 * equality proves the uploader is *an* artist with this name, not
 * *this* artist — for common names it verified the wrong human being
 * (John Mayer, India 1950 → Gravity). A hit must both pass the
 * channel bar AND carry a title from the MBID's own catalog — the
 * record-level fact that anchors identity. Honest null beats the
 * wrong person.
 */
async function searchVerified(
  artistName: string,
  trackTitle: string,
  key: string,
): Promise<SearchHit[]> {
  const q = `${artistName} ${trackTitle}`
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(q)}&key=${key}`,
  )) as {
    items?: {
      id?: { videoId?: string }
      snippet?: { title?: string; channelTitle?: string }
    }[]
  }
  const artist = normalize(artistName)
  const wantedTitle = normalize(trackTitle)
  // An empty normalized value can only match everything or nothing —
  // it verifies nothing, so it matches nothing.
  if (!artist || !wantedTitle) return []
  return (body.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId
    const title = item.snippet?.title
    const channelTitle = item.snippet?.channelTitle ?? ''
    if (!videoId || !title) return []
    const channel = normalize(channelTitle.replace(/ - topic$/i, ''))
    // Official bar (uploader is the artist) AND identity bar (the
    // video is the era-picked work from this MBID's own catalog).
    return channel === artist && normalize(title).includes(wantedTitle)
      ? [{ videoId, title, channelTitle }]
      : []
  })
}

/**
 * Playability gate: public + embeddable + long enough to be a record.
 * BATCHED — videos.list takes up to 50 ids for ONE unit, so checking a
 * dozen candidates costs less than the old one-at-a-time walk over
 * three. Returns the subset of ids that pass, order not guaranteed.
 *
 * The duration floor is half of standing lesson 7: a title match
 * cannot tell a Short or a clip from the song it names.
 */
async function playableSet(
  videoIds: string[],
  key: string,
): Promise<{ playable: Set<string>; meta: Map<string, VideoFacts> }> {
  const playable = new Set<string>()
  const meta = new Map<string, VideoFacts>()
  if (videoIds.length === 0) return { playable, meta }
  // `snippet` and `topicDetails` ride along FREE: videos.list costs one
  // unit per call whatever parts are asked for, and this call already
  // happens for every candidate.
  const body = (await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails,topicDetails&id=${videoIds.slice(0, 50).join(',')}&key=${key}`,
  )) as {
    items?: {
      id?: string
      snippet?: { title?: string; description?: string }
      status?: { embeddable?: boolean; privacyStatus?: string }
      contentDetails?: { duration?: string }
      topicDetails?: { topicCategories?: string[] }
    }[]
  }
  for (const item of body.items ?? []) {
    // Missing id can't identify anything — missing is not a match.
    if (!item.id) continue
    meta.set(item.id, {
      description: item.snippet?.description,
      topicUrls: item.topicDetails?.topicCategories,
    })
    if (
      item.status?.embeddable &&
      item.status.privacyStatus === 'public' &&
      isSongLength(item.contentDetails?.duration)
    ) {
      playable.add(item.id)
    }
  }
  return { playable, meta }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ mbid: string; decade: string }> },
) {
  const { mbid, decade } = await ctx.params
  const name = new URL(request.url).searchParams.get('name')?.trim() ?? ''
  if (!UUID.test(mbid) || !DECADE.test(decade) || !name || name.length > 200) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const decadeYear = Number(decade)
  const key = queueCacheKey(mbid, decade, name)

  // ~35 KB shard, cached per warm process — cheap enough to load before
  // the cache read, and it must be: validity depends on it.
  const dating = await rgDatingFor(mbid)

  try {
    const cached = (await store().get(key, {
      type: 'json',
    })) as CachedResolve | null
    // Surgical purge (owner-approved): pre-rule search-sourced tracks
    // were identity-by-bare-name — treat them as misses and re-resolve.
    // Channel-sourced and rule-corroborated entries stand.
    const poisoned =
      cached?.track?.source === 'search' && !cached.track.corroborated
    // Ungated era (owner-approved, Aug 30 2026): entries written before
    // the content gates passed title-matching alone — the Egypt-2020
    // class (AI kids' video, TV interview) is cached under them. A
    // duration-only recheck cannot see that class, so they re-resolve
    // in full. Stored nulls are re-resolved by the same rule; the gates
    // only ever REMOVE candidates, but the pick may differ.
    const ungated = (cached?.pass ?? 0) < GATE_PASS
    // Era-dating corrections (Stage 4): ONLY artists with corrections
    // revalidate, and only when the dataset version moved — everyone
    // else's entries stay good, so a corrections refresh cannot cause
    // a fleet-wide re-resolve.
    const redated = dating !== null && cached?.cv !== RG_DATING_VERSION
    if (
      cached &&
      !poisoned &&
      !ungated &&
      !redated &&
      (cached.track !== null ||
        Date.now() - Date.parse(cached.at) < NULL_TTL_MS)
    ) {
      return withCacheHeaders(
        NextResponse.json({
          track: cached.track,
          // Pre-multi-track entries can't be cached (GATE_PASS 2), so a
          // served entry always has its list; the fallback is belt-and-
          // braces for a hand-written or partially-written blob.
          tracks: cached.tracks ?? (cached.track ? [cached.track] : []),
        }),
      )
    }
  } catch {
    // Cache read failure — resolve live.
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Queue unavailable' }, { status: 501 })
  }

  try {
    // 1. Era ranking from MusicBrainz release-group dates.
    const groupsBody = (await mbJson(
      `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`,
    )) as { 'release-groups'?: MbReleaseGroup[] }
    const titles = rankEraTitles(
      groupsBody['release-groups'] ?? [],
      decadeYear,
      dating,
      normalize,
    )
    const pick = titles[0] ?? null
    await sleep(MB_DELAY_MS)

    // 2. The artist's own channel, when MusicBrainz curates one.
    const relsBody = (await mbJson(
      `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`,
    )) as { relations?: { url?: { resource?: string } }[] }
    const channelUrl = youtubeRel(relsBody.relations)

    const candidates: {
      videoId: string
      title: string
      source: QueueTrack['source']
      era: QueueTrack['era']
      eraTitle: string
    }[] = []
    const takenVideos = new Set<string>()

    if (channelUrl && titles.length > 0) {
      const id = await channelId(channelUrl, apiKey)
      if (id) {
        const uploads = await channelUploads(id, apiKey)
        // Walk the catalog era-first: every title this artist released,
        // matched against their own uploads. Title containment is safe
        // HERE only because the channel is the artist's own MB-linked
        // one — it picks WHICH video, never WHO. An empty normalized
        // title would match every upload, so it is skipped.
        for (const entry of titles) {
          if (candidates.length >= MAX_CANDIDATES) break
          const wanted = normalize(entry.title)
          if (!wanted) continue
          // ONE video per work. Depth should mean more of the artist's
          // CATALOGUE, not four uploads of one song: matching a whole
          // catalogue returned "Sabali" twice and "Se Te Djon Ye"
          // twice, plus remixes and TV segments of the same record.
          // The pick is the upload whose annotation adds least to the
          // bare title — "(Official Audio)" over "(Eclipse Version)" —
          // because the record is what the title alone names.
          let best: { upload: Upload; noise: number } | null = null
          for (const upload of uploads) {
            if (takenVideos.has(upload.videoId)) continue
            if (!normalize(upload.title).includes(wanted)) continue
            // The other half of standing lesson 7: the artist's own
            // channel carries interviews, trailers and making-ofs under
            // the record's exact title. Free — no API spend to reject.
            if (isNonSongUpload(upload.title, entry.title, name)) continue
            const noise = annotationOf(upload.title, entry.title, name).length
            if (!best || noise < best.noise) best = { upload, noise }
          }
          if (!best) continue
          takenVideos.add(best.upload.videoId)
          candidates.push({
            ...best.upload,
            source: 'channel',
            era: entry.era,
            eraTitle: entry.title,
          })
        }
      }
    }

    // NO TITLE, NO SEARCH: without an era/catalog title from this
    // MBID's own release groups there is nothing to anchor identity,
    // and a bare-name search finds whoever is famous under the name.
    // NOT deepened: one search is 100 units and its identity anchor is
    // a single title, so search-sourced artists stay honestly one-song.
    if (candidates.length === 0 && pick?.title) {
      const hits = await searchVerified(name, pick.title, apiKey)
      for (const hit of hits.slice(0, 3)) {
        if (isNonSongUpload(hit.title, pick.title, name)) continue
        candidates.push({
          videoId: hit.videoId,
          title: hit.title,
          source: 'search',
          era: pick.era,
          eraTitle: pick.title,
        })
      }
    }

    // ONE batched playability call for every candidate (≤50 ids = 1
    // unit) — cheaper than the old sequential walk over three.
    const { playable, meta } = await playableSet(
      candidates.map((candidate) => candidate.videoId),
      apiKey,
    )

    /**
     * A playlist should always play music (owner ruling, Aug 2026).
     * The duration floor and title markers alone let three non-songs
     * open real queues; these verdicts add YouTube's own topic
     * classification and the description's first line.
     *
     * NO RELEASE VALVE, and the reason is worth keeping. The design
     * proposed one: reinstate a television-topic verdict when it would
     * leave the artist with nothing, since that signal is the inferred
     * one and its measured false-positive mode is broadcast
     * performances. Building it showed the valve defeats its own
     * purpose — Fatma Said resolves to EXACTLY ONE candidate, her NDR
     * talk-show appearance, so "reinstate when nothing else survives"
     * puts the reported bug straight back into Egypt 2020.
     *
     * So an artist with no music-classified upload contributes nothing.
     * That is the honest outcome: they have no music here to play. The
     * cost of a false positive is one artist sitting out a queue of
     * hundreds — never wrong content playing — which is the direction
     * to err in when the rule is "always play music".
     */
    const verdicts = new Map(
      candidates.map((candidate) => {
        const facts = meta.get(candidate.videoId)
        return [
          candidate.videoId,
          nonMusicVerdict({
            title: candidate.title,
            workTitle: candidate.eraTitle,
            artistName: name,
            topicUrls: facts?.topicUrls,
            description: facts?.description,
          }),
        ] as const
      }),
    )
    const tracks: QueueTrack[] = candidates
      .filter(
        (candidate) =>
          playable.has(candidate.videoId) &&
          verdicts.get(candidate.videoId)?.reasons.length === 0,
      )
      .slice(0, MAX_TRACKS_PER_ARTIST)
      .map((candidate) => ({
        videoId: candidate.videoId,
        title: decodeEntities(candidate.title),
        source: candidate.source,
        era: candidate.era,
        // Search hits under the new rule are always title-anchored.
        ...(candidate.source === 'search' ? { corroborated: true } : {}),
        eraTitle: candidate.eraTitle,
      }))
    // `track` remains the era-truest pick — the shape older clients and
    // lib/play/resolve.ts's queue-cache reader still consume.
    const track: QueueTrack | null = tracks[0] ?? null

    try {
      await store().setJSON(key, {
        at: new Date().toISOString(),
        track,
        tracks,
        pass: GATE_PASS,
        cv: RG_DATING_VERSION,
      } satisfies CachedResolve)
    } catch {
      // Cache writes are best-effort.
    }
    return withCacheHeaders(NextResponse.json({ track, tracks }))
  } catch (error) {
    if (error instanceof QuotaError) {
      // Never cached — the queue finishes brewing another day.
      return NextResponse.json({ quota: true }, { status: 503 })
    }
    console.error(`queue resolve ${mbid}/${decade} failed:`, error)
    return NextResponse.json({ error: 'Resolve failed' }, { status: 502 })
  }
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
