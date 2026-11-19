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
import { channelMatchKind, channelNamesFor, findWork, isNameOnly, matchKey, type ArtistAlias } from '../artistMatch'
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const ERA_RANK: Record<TrackEraRating, number> = { 'in-era': 0, nearby: 1, catalog: 2 }

async function mbJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) })
    if (res.status === 503 || res.status === 429) {
      await sleep(1400 * attempt)
      continue
    }
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
    return res.json()
  }
  throw new Error('MusicBrainz rate limited')
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

/** Discogs leads with the era each earns; corrected titles move, never copy. */
function discogsCandidates(
  rows: DiscogsVideoRow[],
  decade: number,
  dating: ArtistDating | null,
  titleKey: (value: string) => string,
  identity: Identity,
): Candidate[] {
  return rows.flatMap(([videoId, work, year, source]) => {
    const corrected = dating?.s[titleKey(work)]
    const era = eraOfYear(corrected ?? year, decade)
    if (corrected !== undefined && era === 'catalog') return []
    const workKind: WorkKind = source === 'd' ? 'discogs' : workKindOf(work, identity)
    return [{ videoId, title: work, source: 'discogs' as const, era, eraTitle: work, workKind, trusted: false }]
  })
}

interface Verified {
  tracks: QueueTrack[]
  /** Uploaders of accepted, untrusted finds: channels worth learning. */
  channels: { channelId: string; channelTitle: string; via: 'discogs' | 'search' }[]
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
      channels.push({ channelId: facts.channelId, channelTitle: facts.channelTitle, via: candidate.source })
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
    // identifies nothing here.
    const work = findWork(title, works.filter((entry) => !isNameOnly(entry.title, name)))
    if (!work) return []
    return [{ videoId, title, source: 'search' as const, era: work.era, eraTitle: work.title, workKind: workKindOf(work.title, identity), trusted: false }]
  })
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
  let works = worksWith(scan.length > 0 ? await songs() : [])

  const scanned = new Set<string>()
  const fromChannels: Candidate[] = []
  for (const channel of scan) {
    scanned.add(channel.id)
    fromChannels.push(...channelCandidates(await channelUploads(channel.id, apiKey), works, identity, channel.trusted))
  }
  const leads = discogsCandidates(await discogsVideosFor(mbid), decade, dating, titleKey, identity)
  let found = await verify([...fromChannels, ...leads], identity, apiKey)
  let searched = false

  if (found.tracks.length === 0) {
    works = worksWith(await songs())
    const pick = works[0]
    if (!pick) return { tracks: [], searched, needsSearch: false }
    if (!request.allowSearch) return { tracks: [], searched, needsSearch: true }
    searched = true
    found = await verify(await searchCandidates(pick, works, identity, request), identity, apiKey)
  }

  // A verified find off an unlinked channel teaches that channel: read its
  // uploads now for more of this decade, and remember it for the others.
  let tracks = found.tracks
  const teacher = found.channels.find((channel) => !scanned.has(channel.channelId))
  if (teacher) {
    works = worksWith(await songs())
    const uploads = await channelUploads(teacher.channelId, apiKey)
    // Only a channel whose uploads can be read is worth remembering —
    // "Topic" channels' upload lists answer 404.
    if (uploads.length > 0) await saveLearnedChannel(mbid, teacher)
    const more = await verify(channelCandidates(uploads, works, identity, false), identity, apiKey)
    tracks = merge(tracks, more.tracks)
  }

  const ranked = [...tracks]
    .sort((a, b) => ERA_RANK[a.era] - ERA_RANK[b.era])
    .slice(0, MAX_TRACKS_PER_ARTIST)
  return { tracks: ranked, searched, needsSearch: false }
}
