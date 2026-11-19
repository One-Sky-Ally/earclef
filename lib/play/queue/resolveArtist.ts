/**
 * Play-queue resolver: ONE artist × decade → their era-ranked, verified
 * songs. Moved out of the queue route and rebuilt on Nov 19 2026 under
 * the owner's principle: it must be the right artist's music, every free
 * source first, a search only when nothing free answers.
 *
 * ORDER OF SOURCES. Everything except search spends from the 10,000
 * bucket at 1 unit per call:
 *   1. the artist's channel: MB-linked, or one a verified find taught us
 *      (learnedChannel.ts) — uploads that name one of their works;
 *   2. Discogs leads (discogsVideos.ts) — videos Discogs lists on their
 *      own records;
 *   3. only then, and only when the caller allows it, ONE YouTube search
 *      (the project's 100-a-day bucket).
 *
 * THE CHECK every candidate passes (lib/play/artistMatch.ts):
 *   - the uploader is named for the artist, unless it is the MB-linked
 *     channel, which MusicBrainz editors already tied to them;
 *   - the CURRENT title names one of the artist's works;
 *   - it is playable (public, embeddable, song-length);
 *   - it passes the music gates (non-song annotations, self-titled,
 *     television/talk/promo verdicts).
 * One video per work: depth should mean more of the catalogue, not four
 * uploads of one song.
 *
 * A verified find from a channel that is not MB-linked teaches that
 * channel. Its uploads are read at once for more songs in this decade,
 * and its other decades read it instead of searching.
 *
 * Zero Anthropic wallet: MusicBrainz + YouTube only.
 */
import type { ArtistDating } from '../../explore/rgDating'
import { channelMatchKind, channelNamesFor, findWork, identifies, isNameOnly, matchKey, type ArtistAlias } from '../artistMatch'
import {
  channelId as resolveChannelId,
  channelUploads,
  decodeEntities,
  playableSetAll,
  QuotaError,
  youtubeRel,
  ytJson,
  type Upload,
} from '../channelSongs'
import { annotationOf, isNonSongUpload, isSelfTitled, namesTheSelfTitledRecord, nonMusicVerdict } from '../contentGates'
import { discogsVideosFor, type DiscogsVideoRow } from '../discogsVideos'
import { eraOfYear, rankEraTitles, type DatedTitle, type EraTitle } from './eraTitles'
import { learnedChannelFor, saveLearnedChannel } from './learnedChannel'
import { recordSearch, type SearchKind } from './searchBudget'
import type { QueueTrack, TrackEraRating } from './types'

const USER_AGENT = 'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const MB = 'https://musicbrainz.org/ws/2'
const MB_DELAY_MS = 1100
/** Songs kept per artist (owner-approved Aug 31, 2026). */
export const MAX_TRACKS_PER_ARTIST = 12
/** Candidates read per channel scan before verification. */
const MAX_CHANNEL_CANDIDATES = 24

export interface ResolveRequest {
  mbid: string
  decade: number
  name: string
  allowSearch: boolean
  searchKind: Extract<SearchKind, 's' | 'w'>
  apiKey: string
  dating: ArtistDating | null
  titleKey: (value: string) => string
}

export interface ResolveResult {
  tracks: QueueTrack[]
  /** A YouTube search was spent. */
  searched: boolean
  /** Nothing free answered and a search was not allowed. */
  needsSearch: boolean
}

type WorkKind = NonNullable<QueueTrack['how']>['work']

interface Candidate {
  videoId: string
  title: string
  source: QueueTrack['source']
  era: TrackEraRating
  eraTitle: string
  workKind: WorkKind
  /** Uploaded to the MB-linked channel: no name check needed. */
  trusted: boolean
}

/** What a verified candidate is checked against: the artist's names. */
interface Identity {
  name: string
  aliases: ArtistAlias[]
  /** Release-group title keys — tells a release title from a song title. */
  releaseKeys: Set<string>
}

const workKindOf = (title: string, identity: Identity): WorkKind =>
  identity.releaseKeys.has(matchKey(title)) ? 'release' : 'song'

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * A work specific enough to stand as the second fact WITHOUT a curated
 * link behind the channel: any release title, or a song title of two
 * words or more, at least 8 letters, or 4 CJK characters. A one-word song
 * title such as "Love" or "Alone" is in too many other artists' uploads
 * (code review, Nov 19 2026: one such coincidence could teach a
 * namesake's channel for every decade).
 */
function isStrongWork(title: string, identity: Identity): boolean {
  const key = matchKey(title)
  if (!key || !identifies(key)) return false
  if (identity.releaseKeys.has(key)) return true
  const chars = key.replace(/ /g, '').length
  return key.includes(' ') || chars >= 8 || (CJK.test(key) && chars >= 4)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const ERA_RANK: Record<TrackEraRating, number> = { 'in-era': 0, nearby: 1, catalog: 2 }

/** MusicBrainz with retries on rate limits, 5xx, timeouts and network errors. */
async function mbJson(url: string): Promise<unknown> {
  let last = 'MusicBrainz unavailable'
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) })
    } catch (error) {
      last = `MusicBrainz unreachable: ${error instanceof Error ? error.message : String(error)}`
      await sleep(1400 * attempt)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      last = `MusicBrainz HTTP ${res.status}`
      await sleep(1400 * attempt)
      continue
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
    return res.json()
  }
  throw new Error(last)
}

/**
 * The channel path, unchanged in spirit: walk the catalogue era-first and
 * take, per work, the upload whose title adds least to the bare title —
 * "(Official Audio)" over "(Eclipse Version)".
 */
function channelCandidates(uploads: Upload[], works: EraTitle[], identity: Identity, trusted: boolean): Candidate[] {
  const { name } = identity
  const taken = new Set<string>()
  const picked: Candidate[] = []
  for (const work of works) {
    if (picked.length >= MAX_CHANNEL_CANDIDATES) break
    const selfTitled = isSelfTitled(work.title, name)
    // A fragment of the artist's name ("Winwood" for Steve Winwood) is in
    // every upload: it identifies no work (hand-check, Nov 19 2026). The
    // self-titled record keeps its own rule below.
    if (!selfTitled && isNameOnly(work.title, name)) continue
    let best: { upload: Upload; noise: number } | null = null
    for (const upload of uploads) {
      if (taken.has(upload.videoId) || !findWork(upload.title, [work])) continue
      if (isNonSongUpload(upload.title, work.title, name)) continue
      if (selfTitled && !namesTheSelfTitledRecord(upload.title, work.title, name)) continue
      const noise = annotationOf(upload.title, work.title, name).length
      if (!best || noise < best.noise) best = { upload, noise }
    }
    if (!best) continue
    taken.add(best.upload.videoId)
    picked.push({
      ...best.upload,
      source: 'channel',
      era: work.era,
      eraTitle: work.title,
      workKind: workKindOf(work.title, identity),
      trusted,
    })
  }
  return picked
}

/**
 * Discogs leads with the era each earns. A title in the MB catalogue takes
 * its era from the full era ranking, so the per-song AND album-span
 * corrections apply (code review, Nov 19 2026: lead years came from
 * whichever record listed the video — Elvis's "Are You Lonesome Tonight?"
 * rated 1997). A title the ranking no longer holds was moved away by a
 * correction and is dropped: move, don't copy. Discogs-only titles take
 * their per-song correction, else the earliest year Discogs gives.
 */
function discogsCandidates(
  rows: DiscogsVideoRow[],
  decade: number,
  dating: ArtistDating | null,
  titleKey: (value: string) => string,
  identity: Identity,
  eraOf: Map<string, TrackEraRating>,
): Candidate[] {
  return rows.flatMap(([videoId, work, year, source]) => {
    if (source === 'm') {
      // Absent from the ranking: a per-song correction may have moved it
      // (drop it outside the bands); otherwise it is a tracklist title MB's
      // first 100 recordings did not reach, so it makes no era claim.
      const corrected = dating?.s[titleKey(work)]
      const era = eraOf.get(titleKey(work)) ?? (corrected !== undefined ? eraOfYear(corrected, decade) : 'catalog')
      if (corrected !== undefined && !eraOf.has(titleKey(work)) && era === 'catalog') return []
      return [{ videoId, title: work, source: 'discogs' as const, era, eraTitle: work, workKind: workKindOf(work, identity), trusted: false }]
    }
    const corrected = dating?.s[titleKey(work)]
    const era = eraOfYear(corrected ?? year, decade)
    if (corrected !== undefined && era === 'catalog') return []
    return [{ videoId, title: work, source: 'discogs' as const, era, eraTitle: work, workKind: 'discogs' as const, trusted: false }]
  })
}

interface Verified {
  tracks: QueueTrack[]
  /** Uploaders of accepted, untrusted finds: channels worth learning. */
  channels: { channelId: string; channelTitle: string; via: 'discogs' | 'search'; videoId: string }[]
}

/** The check every candidate passes, in one batched videos.list. */
async function verify(candidates: Candidate[], identity: Identity, apiKey: string): Promise<Verified> {
  const { name, aliases } = identity
  if (candidates.length === 0) return { tracks: [], channels: [] }
  const { playable, meta } = await playableSetAll(candidates.map((candidate) => candidate.videoId), apiKey)
  const works = new Set<string>()
  const videos = new Set<string>()
  const tracks: QueueTrack[] = []
  const channels: Verified['channels'] = []
  for (const candidate of candidates) {
    const facts = meta.get(candidate.videoId)
    if (!facts || !playable.has(candidate.videoId) || videos.has(candidate.videoId)) continue
    const workKey = matchKey(candidate.eraTitle)
    if (!workKey || works.has(workKey)) continue
    const named = candidate.trusted ? null : channelMatchKind(facts.channelTitle ?? '', name, aliases)
    if (!candidate.trusted && !named) continue
    const title = facts.title ?? candidate.title
    if (!findWork(title, [{ title: candidate.eraTitle, era: candidate.era }])) continue
    if (isNonSongUpload(title, candidate.eraTitle, name)) continue
    if (isSelfTitled(candidate.eraTitle, name) && !namesTheSelfTitledRecord(title, candidate.eraTitle, name)) continue
    const verdict = nonMusicVerdict({
      title,
      workTitle: candidate.eraTitle,
      artistName: name,
      topicUrls: facts.topicUrls,
      description: facts.description,
    })
    if (verdict.reasons.length > 0) continue
    works.add(workKey)
    videos.add(candidate.videoId)
    tracks.push({
      videoId: candidate.videoId,
      title: decodeEntities(title),
      source: candidate.source,
      era: candidate.era,
      eraTitle: candidate.eraTitle,
      ...(candidate.source === 'search' ? { corroborated: true } : {}),
      how: {
        channel: candidate.trusted ? 'mb-link' : candidate.source === 'channel' ? 'learned' : (named ?? 'name'),
        work: candidate.workKind,
      },
    })
    if (candidate.source !== 'channel' && facts.channelId && facts.channelTitle) {
      channels.push({ channelId: facts.channelId, channelTitle: facts.channelTitle, via: candidate.source, videoId: candidate.videoId })
    }
  }
  return { tracks, channels }
}

interface SearchItem {
  id?: { videoId?: string }
  snippet?: { title?: string; channelTitle?: string }
}

/** ONE search; results kept only when they pass the name and work checks. */
async function searchCandidates(
  pick: EraTitle,
  works: EraTitle[],
  identity: Identity,
  request: ResolveRequest,
): Promise<Candidate[]> {
  const { name } = identity
  await recordSearch(request.searchKind)
  let body: { items?: SearchItem[] }
  try {
    body = (await ytJson(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(`${name} ${pick.title}`)}&key=${request.apiKey}`,
    )) as { items?: SearchItem[] }
  } catch (error) {
    if (error instanceof QuotaError) await recordSearch('r')
    throw error
  }
  return (body.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId
    const title = item.snippet?.title ? decodeEntities(item.snippet.title) : ''
    if (!videoId || !title || !channelMatchKind(item.snippet?.channelTitle ?? '', name, identity.aliases)) return []
    // A self-titled record is in every upload naming the artist: it
    // identifies nothing here. Beyond the searched title, only strong
    // works confirm a search hit.
    const work = findWork(
      title,
      works.filter(
        (entry) => !isNameOnly(entry.title, name) && (matchKey(entry.title) === matchKey(pick.title) || isStrongWork(entry.title, identity)),
      ),
    )
    if (!work) return []
    return [{ videoId, title, source: 'search' as const, era: work.era, eraTitle: work.title, workKind: workKindOf(work.title, identity), trusted: false }]
  })
}

/**
 * A verified find off an unlinked channel teaches that channel. Its uploads
 * are read at once for more of this decade, and it is remembered for the
 * artist's other decades, but only when corroborated (code review, Nov 19
 * 2026): the teaching find named a release title, or the channel's own
 * uploads name another of the artist's strong works. Any failure here
 * keeps what was already found, so a search already paid for is never
 * thrown away.
 */
async function withTeacher(
  found: Verified,
  scanned: Set<string>,
  identity: Identity,
  request: ResolveRequest,
  allWorks: () => Promise<EraTitle[]>,
): Promise<QueueTrack[]> {
  const teacher = found.channels.find((channel) => !scanned.has(channel.channelId))
  if (!teacher) return found.tracks
  try {
    const uploads = await channelUploads(teacher.channelId, request.apiKey)
    // "Topic" channels' upload lists answer 404: nothing to read or learn.
    if (uploads.length === 0) return found.tracks
    const works = (await allWorks()).filter((work) => isStrongWork(work.title, identity))
    const more = await verify(channelCandidates(uploads, works, identity, false), identity, request.apiKey)
    const merged = merge(found.tracks, more.tracks)
    const teaching = found.tracks.find((track) => track.videoId === teacher.videoId)
    const corroborated = teaching?.how?.work === 'release' || merged.length > found.tracks.length
    if (!corroborated) return found.tracks
    await saveLearnedChannel(request.mbid, teacher)
    return merged
  } catch {
    return found.tracks
  }
}

function merge(held: QueueTrack[], more: QueueTrack[]): QueueTrack[] {
  const videos = new Set(held.map((track) => track.videoId))
  const works = new Set(held.map((track) => matchKey(track.eraTitle ?? '')))
  const added = more.filter((track) => !videos.has(track.videoId) && !works.has(matchKey(track.eraTitle ?? '')))
  return [...held, ...added]
}

export async function resolveArtist(request: ResolveRequest): Promise<ResolveResult> {
  const { mbid, decade, name, apiKey, dating, titleKey } = request
  const groupsBody = (await mbJson(`${MB}/release-group?artist=${mbid}&limit=100&fmt=json`)) as {
    'release-groups'?: DatedTitle[]
  }
  const groups = groupsBody['release-groups'] ?? []
  await sleep(MB_DELAY_MS)
  const artistBody = (await mbJson(`${MB}/artist/${mbid}?inc=url-rels+aliases&fmt=json`)) as {
    relations?: { url?: { resource?: string } }[]
    aliases?: { name?: string; type?: string | null }[]
  }
  const aliases = (artistBody.aliases ?? []).flatMap((alias) =>
    alias.name ? [{ name: alias.name, type: alias.type ?? null }] : [],
  )
  const names = channelNamesFor(name, aliases)
  const identity: Identity = {
    name,
    aliases,
    releaseKeys: new Set(groups.map((group) => matchKey(group.title ?? '')).filter(Boolean)),
  }

  let recordings: DatedTitle[] | null = null
  /** Set when the recordings call failed — then "no titles" is not an answer. */
  let recordingsFailed = false
  const songs = async (): Promise<DatedTitle[]> => {
    if (recordings) return recordings
    await sleep(MB_DELAY_MS)
    try {
      const body = (await mbJson(`${MB}/recording?artist=${mbid}&limit=100&fmt=json`)) as {
        recordings?: { title?: string; 'first-release-date'?: string }[]
      }
      recordings = (body.recordings ?? []).map((recording) => ({
        title: recording.title,
        'first-release-date': recording['first-release-date'],
        'primary-type': 'Recording',
      }))
    } catch {
      recordingsFailed = true
      recordings = []
    }
    return recordings
  }
  const worksWith = (extra: DatedTitle[]) => rankEraTitles([...groups, ...extra], decade, dating, titleKey)

  const mbChannelUrl = youtubeRel(artistBody.relations)
  const mbChannel = mbChannelUrl ? await resolveChannelId(mbChannelUrl, apiKey) : null
  const learned = await learnedChannelFor(mbid, names, apiKey)
  const scan = [
    ...(mbChannel ? [{ id: mbChannel, trusted: true }] : []),
    ...(learned && learned.channelId !== mbChannel ? [{ id: learned.channelId, trusted: false }] : []),
  ]
  const leadRows = await discogsVideosFor(mbid)
  let works = worksWith(scan.length > 0 || leadRows.length > 0 ? await songs() : [])
  const strong = (list: EraTitle[]) => list.filter((work) => isStrongWork(work.title, identity))

  const scanned = new Set<string>()
  const fromChannels: Candidate[] = []
  for (const channel of scan) {
    scanned.add(channel.id)
    // A learned channel has no curated link behind it: strong works only.
    const usable = channel.trusted ? works : strong(works)
    fromChannels.push(...channelCandidates(await channelUploads(channel.id, apiKey), usable, identity, channel.trusted))
  }
  const eraOf = new Map(
    rankEraTitles([...groups, ...(recordings ?? [])], decade, dating, titleKey, Infinity).map(
      (work) => [titleKey(work.title), work.era] as const,
    ),
  )
  const leads = discogsCandidates(leadRows, decade, dating, titleKey, identity, eraOf)
  let found = await verify([...fromChannels, ...leads], identity, apiKey)
  let searched = false

  if (found.tracks.length === 0) {
    works = worksWith(await songs())
    // The searched title must identify something: never "Name Name".
    const pick = works.find((work) => identifies(matchKey(work.title)) && !isNameOnly(work.title, name))
    if (!pick) {
      // A failed recordings call is not "this artist has no titles":
      // fail this request, so nothing is cached and a later one retries.
      if (recordingsFailed) throw new Error('MusicBrainz recordings unavailable')
      return { tracks: [], searched, needsSearch: false }
    }
    if (!request.allowSearch) return { tracks: [], searched, needsSearch: true }
    searched = true
    found = await verify(await searchCandidates(pick, works, identity, request), identity, apiKey)
  }

  const tracks = await withTeacher(found, scanned, identity, request, () => songs().then(worksWith))

  const ranked = [...tracks]
    .sort((a, b) => ERA_RANK[a.era] - ERA_RANK[b.era])
    .slice(0, MAX_TRACKS_PER_ARTIST)
  return { tracks: ranked, searched, needsSearch: false }
}
