/**
 * Original one-to-two-sentence descriptions for feed items — the Discover
 * pattern applied per-item: ONE batched Haiku call for whatever isn't
 * cached yet, then cached in Blobs forever (a blurb is written once per
 * item, ever). The model sees ONLY our metadata plus its own general
 * knowledge — never scraped text, reviews, or press — so every word is
 * original to Ear Clef.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getStore } from '@netlify/blobs'
import { blurbKey, type FeedItemType } from './blurbKey'

export interface BlurbRequestItem {
  slug: string
  artistName: string
  title: string
  type: FeedItemType
  /** YYYY[-MM[-DD]] */
  date: string
}

const MODEL = 'claude-haiku-4-5'
const MAX_BLURB_CHARS = 240

const BLURBS_SCHEMA = {
  type: 'object',
  properties: {
    blurbs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The item key, echoed exactly' },
          text: {
            type: 'string',
            description: 'One or two factual sentences, max 220 characters',
          },
        },
        required: ['key', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['blurbs'],
  additionalProperties: false,
} as const

let devBlurbs = new Map<string, string>()

function store() {
  return getStore({ name: 'blurbs', consistency: 'strong' })
}

export async function readCachedBlurbs(
  keys: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      try {
        const entry = (await store().get(key, { type: 'json' })) as {
          text?: string
        } | null
        return [key, entry?.text ?? null] as const
      } catch {
        return [key, devBlurbs.get(key) ?? null] as const
      }
    }),
  )
  return Object.fromEntries(
    entries.filter(([, text]) => text !== null),
  ) as Record<string, string>
}

async function cacheBlurb(key: string, text: string): Promise<void> {
  try {
    await store().setJSON(key, {
      text,
      model: MODEL,
      at: new Date().toISOString(),
    })
  } catch {
    devBlurbs = new Map(devBlurbs).set(key, text)
  }
}

function buildPrompt(items: BlurbRequestItem[]): string {
  const lines = items
    .map(
      (item) =>
        `- key: ${blurbKey(item.slug, item.type, item.title)}\n  artist: ${item.artistName}\n  title: ${item.title}\n  kind: ${item.type === 'video' ? 'video' : 'music release'}\n  date: ${item.date}`,
    )
    .join('\n')

  return `You write the one-line descriptions under items in the "Latest" feed on Ear Clef, a small music site. For each item below, write one or two plain factual sentences (max 220 characters) describing what it is, so a visitor learns something without leaving the page.

Rules:
- Use ONLY the metadata given plus your own general knowledge of the artist and their catalog. Nothing else exists.
- If you genuinely recognize the release or video, be specific: its place in the artist's arc, its sound, what it is.
- If you don't recognize it, write a graceful generic line built from the metadata alone (e.g. "A new single from X, released March 2026." or simply what the metadata supports).
- Name a specific fact — a producer, collaborator, label, or context — ONLY if you are certain it belongs to THIS exact release, not a different album by the same artist. When in doubt, describe the artist's known style instead. A vague true sentence always beats a specific wrong one.
- Never quote or paraphrase critics, reviews, or other people's writing. Never invent reception or chart positions.
- Plain warm tone. No hype words ("stunning", "must-listen"), no exclamation points, no first person.
- Keep each blurb under 200 characters — it must end as a complete sentence.
- Echo each item's key exactly.

Items:
${lines}`
}

/**
 * Overlong blurbs are trimmed at a sentence boundary, never mid-word; a
 * runaway single sentence is dropped entirely — no blurb beats a
 * fragment that ends "…one of the decade's most innova".
 */
function tidyBlurb(raw: string | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  if (text.length <= MAX_BLURB_CHARS) return text
  const cut = text.slice(0, MAX_BLURB_CHARS)
  const lastSentenceEnd = cut.lastIndexOf('. ')
  return lastSentenceEnd > 60 ? cut.slice(0, lastSentenceEnd + 1) : null
}

/**
 * One model call for the whole batch. Returns key→text for what it
 * produced; failures return {} and the feed simply shows no blurbs.
 */
export async function generateBlurbs(
  items: BlurbRequestItem[],
): Promise<Record<string, string>> {
  if (items.length === 0 || !process.env.ANTHROPIC_API_KEY) return {}
  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: {
        format: { type: 'json_schema', schema: BLURBS_SCHEMA },
      },
      messages: [{ role: 'user', content: buildPrompt(items) }],
    })
    if (response.stop_reason === 'refusal') return {}
    const text = response.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') return {}
    const parsed = JSON.parse(text.text) as {
      blurbs: { key: string; text: string }[]
    }

    const validKeys = new Set(
      items.map((item) => blurbKey(item.slug, item.type, item.title)),
    )
    const produced: Record<string, string> = {}
    for (const blurb of parsed.blurbs) {
      const clean = tidyBlurb(blurb.text)
      if (!validKeys.has(blurb.key) || !clean) continue
      produced[blurb.key] = clean
      await cacheBlurb(blurb.key, clean)
    }
    return produced
  } catch (error) {
    console.error('Blurb generation failed:', error)
    return {}
  }
}
