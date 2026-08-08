/**
 * Daily Discover pool generation: one Claude call proposes 12 off-roster
 * artists tuned to the owner's tiers, then each pick is verified against
 * MusicBrainz (real artists only — the site's verified-data bar applies to
 * AI output too). Runs in the background function in production and inline
 * in dev, so it can take its time; callers never block a visitor on it.
 */
import Anthropic from '@anthropic-ai/sdk'
// Relative imports (not the @/ alias): this module is bundled into the
// Netlify background function, whose bundler doesn't read tsconfig paths.
import { resolveMbArtistPlay } from '../play/resolve'
import type { PlayLink, ReadLink } from '../play/types'
import roster from './roster.json'

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
}

export interface DiscoverPool {
  date: string
  picks: DiscoverPick[]
}

interface RawPick {
  name: string
  why: string
  knownFor: string
}

const POOL_SIZE = 12
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
        },
        required: ['name', 'why', 'knownFor'],
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

function buildPrompt(date: string, avoid: string[]): string {
  const byTier = (tier: string) =>
    roster
      .filter((artist) => artist.tier === tier)
      .map((artist) => `- ${artist.name} — ${artist.identity}`)
      .join('\n')

  return `You are the resident ear at Ear Clef, a small curated music site. Today is ${date}. Recommend ${POOL_SIZE} artists for the owner's daily Discover section.

The owner's library, by personal rotation tier:

HEAVY ROTATION (strongest taste signal):
${byTier('heavy-rotation')}

IN THE MIX (moderate signal):
${byTier('in-the-mix')}

Rules:
- Recommend artists a person with exactly this library would love but has plausibly never tracked down — genuinely lesser-known discoveries, not obvious adjacent stars. No one already famous to a fan of this list.
- NEVER recommend anyone already in the library above.
- Also avoid these recently recommended artists: ${avoid.length > 0 ? avoid.join(', ') : '(none yet)'}
- Only real artists you are confident exist, with the name exactly as credited on releases (they will be verified against MusicBrainz; invented or misspelled names get discarded).
- Spread the picks across the library's range — don't cluster all ${POOL_SIZE} around one roster artist.
- "why" must name the roster artist it connects to and be specific about the musical link, in one sentence.
- "knownFor" is one real album or song title by that artist.`
}

async function callClaude(prompt: string): Promise<RawPick[]> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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
  return parsed.picks
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
): Promise<string | null> {
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
    return proposed
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
        return proposed
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
  return replacement?.title ?? null
}

/** Full pipeline: model -> roster/repeat filters -> MusicBrainz -> pool. */
export async function generatePool(
  date: string,
  recentNames: string[],
): Promise<DiscoverPool> {
  const raw = await callClaude(buildPrompt(date, recentNames))

  const recentKeys = new Set(recentNames.map(normalize))
  const seen = new Set<string>()
  const picks: DiscoverPick[] = []

  for (const pick of raw) {
    const key = normalize(pick.name)
    if (!key || ROSTER_KEYS.has(key) || recentKeys.has(key) || seen.has(key)) {
      continue
    }
    seen.add(key)
    const match = await verifyOnMusicBrainz(pick.name)
    await sleep(1100) // MusicBrainz rate limit: 1 req/s
    if (!match) continue

    const knownFor = await verifiedKnownFor(match.mbid, pick.knownFor)
    if (!knownFor) continue // no verifiable catalog — the pick is out

    const { play, read } = await resolveMbArtistPlay(match.mbid, null)
    await sleep(1100)
    picks.push({
      name: match.canonicalName,
      why: pick.why,
      knownFor,
      knownForVerified: true,
      mbid: match.mbid,
      play,
      read: read ?? {
        kind: 'musicbrainz',
        url: `https://musicbrainz.org/artist/${match.mbid}`,
      },
      listenHref: play?.url ?? read?.url ?? `https://musicbrainz.org/artist/${match.mbid}`,
    })
  }

  if (picks.length < 3) {
    throw new Error(`Only ${picks.length} picks survived verification`)
  }
  return { date, picks }
}
