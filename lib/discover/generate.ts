/**
 * Daily Discover pool generation: one Claude call proposes 12 off-roster
 * artists from a library — the whole roster for the shared pool, the
 * owner's own rows for theirs (./library) — then each pick is verified against
 * MusicBrainz (real artists only — the site's verified-data bar applies to
 * AI output too). Runs in the background function in production and inline
 * in dev, so it can take its time; callers never block a visitor on it.
 */
import Anthropic from '@anthropic-ai/sdk'
// Relative imports (not the @/ alias): this module is bundled into the
// Netlify background function, whose bundler doesn't read tsconfig paths.
import {
  bandcampRel,
  fetchMbArtist,
  mbAliasNames,
  resolveMbArtistPlay,
} from '../play/resolve'
import type { PlayLink, ReadLink } from '../play/types'
import roster from './roster.json'
import { buildPrompt, type DiscoverLibrary } from './prompt'
import { resolveDiscoverSong, type DiscoverSong } from './song'

export interface DiscoverPick {
  name: string
  why: string
  /**
   * A representative album or song. VERIFIED against the artist's
   * MusicBrainz release groups / recordings — a model may propose a
   * title, but an unverifiable one is replaced with the artist's real
   * top release (fabrications never reach the page; see the Butcher
   * Brown "Camp Culture" incident, Aug 2026).
   */
  knownFor: string
  /** True for freshly generated picks; false only for sanitized legacy pools. */
  knownForVerified: boolean
  mbid: string
  /** Verified play destination, or null — the card shows read-about. */
  play: PlayLink | null
  read: ReadLink
  /** Back-compat mirror of play?.url ?? read.url. Never a search URL. */
  listenHref: string
  /**
   * A verified, playable YouTube song (Oct 11 2026; see ./song): the
   * card embeds it and keeps a small Bandcamp link beside it. null =
   * no verified song, and the card renders play/read as before.
   */
  song: DiscoverSong | null
  /** The artist's MB-linked Bandcamp page, whatever `play` picked. */
  bandcamp: string | null
  /**
   * Roster slugs (1–3) whose fans this pick is for — checked against the
   * roster, never matched by name. Listeners get the shared picks that
   * connect to artists in their rows (./match). Absent on older pools.
   */
  connectsTo?: string[]
}

/** What one generation run cost, from the API's own token counts. */
export interface PoolUsage {
  model: string
  inputTokens: number
  outputTokens: number
  /** USD at the model's standard rates (no batch or cache discount). */
  costUsd: number
}

export interface DiscoverPool {
  date: string
  picks: DiscoverPick[]
  usage?: PoolUsage
}

interface RawPick {
  name: string
  why: string
  knownFor: string
  connectsTo: string[]
}

/**
 * Picks asked for per pool. The shared set is the bigger one: visitors
 * see its first VISITOR_PICKS, and each signed-in listener gets the ones
 * that connect to their rows (owner, Oct 15 2026: "one bigger shared set
 * daily, each listener sees the picks matching their rows").
 */
export const POOL_SIZES = { shared: 24, owner: 12 } as const
export const VISITOR_PICKS = 12

const MODEL = 'claude-opus-4-8'
/** USD per million tokens, from the Pricing page (fetched Oct 15 2026). */
const RATES = { input: 5, output: 25 }
/**
 * Hard stop for the whole run, model call included: the background
 * function is killed at 15 minutes, and a killed run writes no pool.
 * Picks not reached by then are skipped, never half-written.
 */
const RUN_BUDGET_MS = 13 * 60 * 1000
/**
 * Wall-clock budget for song resolution across the pool (Discogs at 25
 * calls/min, ~30 s a pick). The background function has 15 minutes;
 * picks past this line get no song rather than no pool.
 */
const SONG_BUDGET_MS = 10 * 60 * 1000
const MB_USER_AGENT =
  'EarClefDiscover/0.1 (https://earclef.com; fiohmemorial@gmail.com)'

const PICKS_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Artist name, exactly as credited' },
          why: {
            type: 'string',
            description:
              "One sentence tying the pick to this roster's taste, naming a roster artist, e.g. \"shares Sigur Rós's glacial build-ups\"",
          },
          knownFor: {
            type: 'string',
            description: 'One representative album or song title',
          },
          connectsTo: {
            type: 'array',
            items: { type: 'string' },
            description:
              'One to three roster slugs (the [bracketed] ids in the list) whose fans this pick is for, the strongest link first',
          },
        },
        required: ['name', 'why', 'knownFor', 'connectsTo'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
} as const

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\band\b/g, '&')
    .replace(/[^a-z0-9&]+/g, '')
}

const ROSTER_KEYS = new Set(
  roster.flatMap((artist) => [normalize(artist.name), normalize(artist.slug)]),
)
const ROSTER_SLUGS = new Set(roster.map((artist) => artist.slug))

/** Only real roster slugs, at most three, in the model's order. */
function rosterLinks(slugs: unknown): string[] {
  if (!Array.isArray(slugs)) return []
  return [...new Set(slugs.filter((slug): slug is string => typeof slug === 'string'))]
    .filter((slug) => ROSTER_SLUGS.has(slug))
    .slice(0, 3)
}

async function callClaude(
  prompt: string,
): Promise<{ picks: RawPick[]; usage: PoolUsage }> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: PICKS_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('Model declined the request')
  }
  const text = response.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') {
    throw new Error('No text block in model response')
  }
  const parsed = JSON.parse(text.text) as { picks: RawPick[] }
  // Thinking is billed as output, so output_tokens covers it.
  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  const usage: PoolUsage = {
    model: MODEL,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * RATES.input + outputTokens * RATES.output) / 1_000_000,
  }
  return { picks: parsed.picks, usage }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface MbArtistMatch {
  mbid: string
  canonicalName: string
}

async function verifyOnMusicBrainz(name: string): Promise<MbArtistMatch | null> {
  const query = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)
  const url = `https://musicbrainz.org/ws/2/artist?query=${query}&limit=3&fmt=json`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': MB_USER_AGENT } })
    if (!res.ok) return null
    const body = (await res.json()) as {
      artists?: { id: string; name: string; score: number }[]
    }
    const top = body.artists?.[0]
    if (!top || top.score < 85) return null
    if (normalize(top.name) !== normalize(name)) return null
    return { mbid: top.id, canonicalName: top.name }
  } catch {
    return null
  }
}

interface MbReleaseGroup {
  title?: string
  'first-release-date'?: string
  'primary-type'?: string
}

interface VerifiedCatalog {
  knownFor: string
  /** The artist's release-group titles, knownFor first then newest first. */
  titles: string[]
}

/** Catalog titles for the song resolver's channel path, newest first. */
function catalogTitles(groups: MbReleaseGroup[], knownFor: string): string[] {
  const dated = groups
    .filter((group): group is MbReleaseGroup & { title: string } => Boolean(group.title))
    .sort((a, b) =>
      (b['first-release-date'] ?? '').localeCompare(a['first-release-date'] ?? ''),
    )
    .map((group) => group.title)
  const seen = new Set<string>()
  return [knownFor, ...dated].filter((title) => {
    const key = normalize(title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Verify the model's knownFor title against the artist's real catalog:
 * a normalized match among their release groups, else one recording
 * search. No match → the artist's own top release replaces it (latest
 * dated album, else latest dated anything, else the first group). An
 * artist with no catalog at all returns null and the pick is dropped.
 */
async function verifiedKnownFor(
  mbid: string,
  proposed: string,
): Promise<VerifiedCatalog | null> {
  const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${mbid}&limit=100&fmt=json`
  let groups: MbReleaseGroup[] = []
  try {
    const res = await fetch(rgUrl, { headers: { 'User-Agent': MB_USER_AGENT } })
    if (res.ok) {
      const body = (await res.json()) as { 'release-groups'?: MbReleaseGroup[] }
      groups = body['release-groups'] ?? []
    }
  } catch {
    // fall through — treated as an empty catalog below
  }
  await sleep(1100) // MusicBrainz rate limit: 1 req/s

  const proposedKey = normalize(proposed)
  if (
    proposedKey &&
    groups.some((group) => normalize(group.title ?? '') === proposedKey)
  ) {
    return { knownFor: proposed, titles: catalogTitles(groups, proposed) }
  }

  try {
    const query = encodeURIComponent(
      `recording:"${proposed.replace(/"/g, '')}" AND arid:${mbid}`,
    )
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${query}&limit=1&fmt=json`,
      { headers: { 'User-Agent': MB_USER_AGENT } },
    )
    if (res.ok) {
      const body = (await res.json()) as { count?: number }
      if ((body.count ?? 0) > 0) {
        await sleep(1100)
        return { knownFor: proposed, titles: catalogTitles(groups, proposed) }
      }
    }
  } catch {
    // fall through to the catalog-sourced replacement
  }
  await sleep(1100)

  const dated = groups
    .filter((group) => group.title && group['first-release-date'])
    .sort((a, b) =>
      (b['first-release-date'] ?? '').localeCompare(
        a['first-release-date'] ?? '',
      ),
    )
  const replacement =
    dated.find((group) => group['primary-type'] === 'Album') ??
    dated[0] ??
    groups.find((group) => group.title)
  return replacement?.title
    ? { knownFor: replacement.title, titles: catalogTitles(groups, replacement.title) }
    : null
}

/** Full pipeline: model -> roster/repeat filters -> MusicBrainz -> pool. */
export async function generatePool(
  date: string,
  recentNames: string[],
  library: DiscoverLibrary,
  size: number,
): Promise<DiscoverPool> {
  const runDeadline = Date.now() + RUN_BUDGET_MS
  const { picks: raw, usage } = await callClaude(
    buildPrompt(date, recentNames, library, size),
  )

  const recentKeys = new Set(recentNames.map(normalize))
  const seen = new Set<string>()
  const picks: DiscoverPick[] = []
  const songDeadline = Math.min(Date.now() + SONG_BUDGET_MS, runDeadline)

  for (const pick of raw) {
    if (Date.now() > runDeadline) break // out of time: keep what's verified
    const key = normalize(pick.name)
    if (!key || ROSTER_KEYS.has(key) || recentKeys.has(key) || seen.has(key)) {
      continue
    }
    seen.add(key)
    const match = await verifyOnMusicBrainz(pick.name)
    await sleep(1100) // MusicBrainz rate limit: 1 req/s
    if (!match) continue

    const catalog = await verifiedKnownFor(match.mbid, pick.knownFor)
    if (!catalog) continue // no verifiable catalog — the pick is out

    // One MB artist call feeds the play chain AND the song resolver.
    const artist = await fetchMbArtist(match.mbid)
    await sleep(1100)
    const { play, read } = await resolveMbArtistPlay(match.mbid, null, artist)
    const song = await resolveDiscoverSong({
      name: match.canonicalName,
      knownFor: catalog.knownFor,
      relations: artist?.relations ?? [],
      aliases: mbAliasNames(artist),
      titles: catalog.titles,
      deadline: songDeadline,
    })
    picks.push({
      name: match.canonicalName,
      why: pick.why,
      knownFor: catalog.knownFor,
      knownForVerified: true,
      mbid: match.mbid,
      play,
      read: read ?? {
        kind: 'musicbrainz',
        url: `https://musicbrainz.org/artist/${match.mbid}`,
      },
      listenHref: play?.url ?? read?.url ?? `https://musicbrainz.org/artist/${match.mbid}`,
      song,
      bandcamp: bandcampRel(artist?.relations),
      connectsTo: rosterLinks(pick.connectsTo),
    })
  }

  if (picks.length < 3) {
    throw new Error(`Only ${picks.length} picks survived verification`)
  }
  return { date, picks, usage }
}
