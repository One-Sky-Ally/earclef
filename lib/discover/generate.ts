/**
 * Daily Discover pool generation: one Claude call proposes 12 off-roster
 * artists tuned to the owner's tiers, then each pick is verified against
 * MusicBrainz (real artists only — the site's verified-data bar applies to
 * AI output too). Runs in the background function in production and inline
 * in dev, so it can take its time; callers never block a visitor on it.
 */
import Anthropic from '@anthropic-ai/sdk'
// Relative import (not the @/ alias): this module is bundled into the
// Netlify background function, whose bundler doesn't read tsconfig paths.
import { listenSearch } from '../links'
import roster from './roster.json'

export interface DiscoverPick {
  name: string
  why: string
  /** A representative album or song, used to build a precise listen search. */
  knownFor: string
  mbid: string
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
  'EarClefDiscover/0.1 (https://earclef.netlify.app; fiohmemorial@gmail.com)'

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
    picks.push({
      name: match.canonicalName,
      why: pick.why,
      knownFor: pick.knownFor,
      mbid: match.mbid,
      listenHref: listenSearch(match.canonicalName, pick.knownFor),
    })
  }

  if (picks.length < 3) {
    throw new Error(`Only ${picks.length} picks survived verification`)
  }
  return { date, picks }
}
