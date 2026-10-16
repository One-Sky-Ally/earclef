/**
 * A playable song for a Discover pick (owner, Oct 10–11 2026: "a
 * playable YouTube song, preferably an official music video, instead
 * of Bandcamp links").
 *
 * SOURCES, both verified before anything is ranked:
 *   1. Discogs release videos under the On-this-day identity bar
 *      (../play/songIdentity): the artist's Discogs id from MusicBrainz's
 *      own url relation is credited on the record, and the video title
 *      equals a track's. Measured Oct 11 on 21 real picks: 21 songs, 14
 *      official videos, 5 quota units.
 *   2. The artist's MB-linked YouTube channel, matched to their release-
 *      group titles — the queue resolver's channel path. Adds the odd
 *      official video Discogs users have not attached yet.
 *   The verified-search path is NOT used here: 100 units a pick for
 *   audio at best, measured.
 *
 * PICK (../play/officialVideo): one batched playability check, the
 * queue's content gates, whole-record uploads out; then official video
 * → audio → plain video, non-official uploads only from a trusted
 * uploader (the artist, their VEVO/official/Topic channel, a credited
 * label); the pick's knownFor title leads its tier. Nothing found →
 * null, and the card keeps its current link.
 *
 * Relative imports only: bundled into the Netlify background function.
 */
import {
  channelId,
  channelUploads,
  decodeEntities,
  playableSet,
  youtubeRel,
  type Upload,
} from '../play/channelSongs'
import {
  annotationOf,
  isNonSongUpload,
  isSelfTitled,
  namesTheSelfTitledRecord,
  nonMusicVerdict,
} from '../play/contentGates'
import { discogsArtistRecords } from '../play/discogsApi'
import { isTrustedUploader, isWholeRecordUpload, uploadKindOf, type UploadKind } from '../play/officialVideo'
import { recordSongCandidates } from '../play/songIdentity'
import { normalizeName, titleVariants, variantsIntersect } from '../play/titleVariants'

export interface DiscoverSong {
  videoId: string
  /** The song as the catalog names it. */
  title: string
  /** The upload's own title on YouTube. */
  uploadTitle: string
  kind: UploadKind
  source: 'discogs' | 'channel'
  uploader: string
  /** The record the song was verified on (Discogs source). */
  release?: string
}

interface MbUrlRelation {
  type?: string
  url?: { resource?: string }
}

export interface SongContext {
  name: string
  knownFor: string
  /** The artist's MusicBrainz url relations (already fetched for play). */
  relations: readonly MbUrlRelation[]
  /** Canonical name plus typed MB aliases. */
  aliases: readonly string[]
  /** Release-group titles for the channel path. */
  titles: readonly string[]
  /** Epoch ms: no new network work after this. */
  deadline: number
  /** Discogs records read at most (the local stocking run reads deeper). */
  maxRecords?: number
  /** Step-by-step notes on how the song was (or wasn't) found — `discover-stock why`. */
  trace?: (line: string) => void
}

/** Before playability: what was found and where. */
interface Found {
  videoId: string
  uploadTitle: string
  songTitle: string
  release: string
  source: DiscoverSong['source']
}

/** After playability: what the ranking reads. */
export interface RankedInput extends Found {
  uploader: string
  playable: boolean
  nonMusic: boolean
}

interface RankContext {
  name: string
  aliases: ReadonlySet<string>
  knownFor: string
  labels: readonly string[]
}

/** Verified Discogs songs that are plenty to rank: reading stops here. */
const ENOUGH_SONGS = 8
/** Candidates the batched playability call can take: 50 ids = 1 unit. */
const MAX_CHECKED = 50
/** Titles walked on the artist's own channel. */
const MAX_CHANNEL_TITLES = 40
const TIER: Record<UploadKind, number> = { 'official-video': 0, audio: 1, video: 2 }

export function discogsIdsOf(relations: readonly MbUrlRelation[]): number[] {
  return relations.flatMap((relation) => {
    const match = relation.url?.resource?.match(/^https?:\/\/(?:www\.)?discogs\.com\/artist\/(\d+)/)
    return match ? [Number(match[1])] : []
  })
}

/**
 * The queue resolver's channel walk, era-free: for each catalog title
 * the upload whose annotation adds least (official video preferred by
 * the ranking later, not here). Containment is safe HERE only because
 * the channel is the artist's own MB-linked one — it picks WHICH
 * video, never WHO.
 */
function channelCandidates(uploads: readonly Upload[], titles: readonly string[], name: string): Found[] {
  const taken = new Set<string>()
  return titles.slice(0, MAX_CHANNEL_TITLES).flatMap((title) => {
    const wanted = normalizeName(title)
    if (!wanted) return []
    const selfTitled = isSelfTitled(title, name)
    const best = uploads
      .filter((upload) => !taken.has(upload.videoId))
      .filter((upload) => normalizeName(upload.title).includes(wanted))
      .filter((upload) => !isNonSongUpload(upload.title, title, name))
      .filter((upload) => !selfTitled || namesTheSelfTitledRecord(upload.title, title, name))
      .map((upload) => ({ upload, noise: annotationOf(upload.title, title, name).length }))
      .sort((a, b) => a.noise - b.noise)[0]
    if (!best) return []
    taken.add(best.upload.videoId)
    return [
      {
        videoId: best.upload.videoId,
        uploadTitle: decodeEntities(best.upload.title),
        songTitle: title,
        release: title,
        source: 'channel' as const,
      },
    ]
  })
}

async function fromChannel(context: SongContext, apiKey: string): Promise<Found[]> {
  const trace = context.trace
  const channelUrl = youtubeRel([...context.relations])
  if (!channelUrl) trace?.('channel: MusicBrainz lists no YouTube channel for the artist')
  if (!channelUrl || context.titles.length === 0 || Date.now() > context.deadline) return []
  try {
    const id = await channelId(channelUrl, apiKey)
    if (!id) {
      trace?.(`channel: ${channelUrl} did not resolve to a channel id`)
      return []
    }
    const uploads = await channelUploads(id, apiKey)
    const found = channelCandidates(uploads, context.titles, context.name)
    trace?.(
      `channel: ${uploads.length} uploads; ${found.length} match a release-group title (${context.titles.length} titles walked — album TRACKS are not matched on this path)`,
    )
    return found
  } catch (error) {
    trace?.(`channel: failed (${(error as Error).message})`)
    return [] // quota or network: the Discogs path still stands
  }
}

async function fromDiscogs(
  context: SongContext,
  aliases: ReadonlySet<string>,
): Promise<{ found: Found[]; labels: string[] }> {
  const trace = context.trace
  const ids = discogsIdsOf(context.relations)
  if (ids.length === 0) {
    trace?.('discogs: MusicBrainz lists no Discogs artist for the artist')
    return { found: [], labels: [] }
  }
  const idSet = new Set(ids)
  const { records, labels } = await discogsArtistRecords(ids, {
    deadline: context.deadline,
    preferTitles: [context.knownFor],
    maxRecords: context.maxRecords,
    enough: (read) => recordSongCandidates(read, idSet, aliases).length >= ENOUGH_SONGS,
  })
  const verified = recordSongCandidates(records, idSet, aliases)
  if (trace) {
    trace(`discogs: artist ${ids.join(', ')}; ${records.length} records with videos read`)
    for (const record of records) {
      const kept = verified.filter((candidate) => candidate.release === record.title).length
      trace(`  ${record.year ?? '????'} "${record.title}": ${record.videos.length} videos, ${kept} pass the identity bar`)
      for (const video of record.videos.slice(0, 12)) {
        const ok = verified.some((candidate) => candidate.videoId === video.videoId)
        trace(`    ${ok ? '✓' : '·'} ${video.title}`)
      }
    }
  }
  const found = verified.map((candidate) => ({
    videoId: candidate.videoId,
    uploadTitle: candidate.uploadTitle,
    songTitle: candidate.songTitle,
    release: candidate.release,
    source: 'discogs' as const,
  }))
  return { found, labels }
}

/** Order candidates before the one playability call so the best 50 are checked. */
function preRank(found: readonly Found[], context: RankContext): Found[] {
  const knownFor = titleVariants(context.knownFor, context.aliases)
  const score = (entry: Found) =>
    TIER[uploadKindOf(entry.uploadTitle, entry.songTitle, context.name)] * 2 +
    (variantsIntersect(titleVariants(entry.songTitle, context.aliases), knownFor) ||
    variantsIntersect(titleVariants(entry.release, context.aliases), knownFor)
      ? 0
      : 1)
  return [...found].sort((a, b) => score(a) - score(b))
}

/** One video per id: the artist's own channel wins a tie with Discogs. */
function dedupe(found: readonly Found[]): Found[] {
  const byId = new Map<string, Found>()
  for (const entry of found) {
    const held = byId.get(entry.videoId)
    if (!held || (held.source === 'discogs' && entry.source === 'channel')) byId.set(entry.videoId, entry)
  }
  return [...byId.values()]
}

/**
 * The ranking over playability-checked candidates. Pure, so the rules
 * are testable without the network.
 */
export function chooseSong(candidates: readonly RankedInput[], context: RankContext): DiscoverSong | null {
  const knownFor = titleVariants(context.knownFor, context.aliases)
  const ranked = candidates
    .filter((entry) => entry.playable && !entry.nonMusic)
    .filter((entry) => !isWholeRecordUpload(entry.uploadTitle, entry.songTitle, context.name))
    .map((entry) => ({
      entry,
      kind: uploadKindOf(entry.uploadTitle, entry.songTitle, context.name, entry.uploader),
    }))
    .filter(
      ({ entry, kind }) =>
        kind === 'official-video' ||
        entry.source === 'channel' ||
        isTrustedUploader(entry.uploader, context.aliases, context.labels),
    )
    .map(({ entry, kind }, order) => ({
      entry,
      kind,
      tier: TIER[kind],
      known:
        variantsIntersect(titleVariants(entry.songTitle, context.aliases), knownFor) ||
        variantsIntersect(titleVariants(entry.release, context.aliases), knownFor)
          ? 0
          : 1,
      order,
    }))
    .sort((a, b) => a.tier - b.tier || a.known - b.known || a.order - b.order)
  const best = ranked[0]
  if (!best) return null
  return {
    videoId: best.entry.videoId,
    title: best.entry.songTitle,
    uploadTitle: best.entry.uploadTitle,
    kind: best.kind,
    source: best.entry.source,
    uploader: best.entry.uploader,
    ...(best.entry.source === 'discogs' ? { release: best.entry.release } : {}),
  }
}

/** Full resolution for one pick. Never throws: null is the honest miss. */
export async function resolveDiscoverSong(context: SongContext): Promise<DiscoverSong | null> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || Date.now() > context.deadline) return null
  const aliases = new Set(context.aliases.map(normalizeName).filter((key) => key !== ''))
  const rank: RankContext = { name: context.name, aliases, knownFor: context.knownFor, labels: [] }
  try {
    const [discogs, channel] = await Promise.all([
      fromDiscogs(context, aliases),
      fromChannel(context, apiKey),
    ])
    const context2 = { ...rank, labels: discogs.labels }
    const checked = preRank(dedupe([...channel, ...discogs.found]), context2).slice(0, MAX_CHECKED)
    if (checked.length === 0) {
      context.trace?.('result: no verified candidate video on either path')
      return null
    }
    const { playable, meta } = await playableSet(
      checked.map((entry) => entry.videoId),
      apiKey,
    )
    const inputs: RankedInput[] = checked.map((entry) => {
      const facts = meta.get(entry.videoId)
      return {
        ...entry,
        uploader: facts?.channelTitle ?? '',
        playable: playable.has(entry.videoId),
        nonMusic:
          nonMusicVerdict({
            title: entry.uploadTitle,
            workTitle: entry.songTitle,
            artistName: context.name,
            topicUrls: facts?.topicUrls,
            description: facts?.description,
          }).reasons.length > 0,
      }
    })
    if (context.trace) {
      for (const input of inputs) {
        const kind = uploadKindOf(input.uploadTitle, input.songTitle, context.name, input.uploader)
        const trusted = isTrustedUploader(input.uploader, aliases, discogs.labels)
        context.trace(
          `candidate ${input.videoId} "${input.uploadTitle}" by ${input.uploader || '?'} → ${kind}` +
            `${input.playable ? '' : ', NOT playable'}${input.nonMusic ? ', flagged non-music' : ''}` +
            `${kind === 'official-video' || input.source === 'channel' || trusted ? '' : ', uploader not trusted'}`,
        )
      }
    }
    const chosen = chooseSong(inputs, context2)
    context.trace?.(chosen ? `result: ${chosen.kind} "${chosen.uploadTitle}"` : 'result: every candidate was ruled out')
    return chosen
  } catch (error) {
    console.error(`discover song for ${context.name} failed:`, error)
    return null
  }
}
