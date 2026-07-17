import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getStore } from '@netlify/blobs'
import { isGenreLens } from '@/lib/explore/genreData'
import emergence from '@/public/data/genre-artist-emergence.json'

/**
 * The genre's origin-and-spread story: generated ONCE per genre ever
 * (the feed-blurb pattern — Blobs cache + memo + 30-day CDN), grounded
 * in our own emergence dataset plus general music history. Pioneer
 * artists come back wrapped in [[markers]] so the client can render
 * them as YouTube-search links.
 */

const MODEL = 'claude-opus-4-8'

interface StoryRecord {
  story: string
  model: string
  at: string
}

const memo = new Map<string, StoryRecord>()
let devStories = new Map<string, StoryRecord>()

function store() {
  return getStore({ name: 'blurbs', consistency: 'strong' })
}

const storyKey = (genre: string) => `story/${genre}`

async function readCached(genre: string): Promise<StoryRecord | null> {
  try {
    return ((await store().get(storyKey(genre), { type: 'json' })) ??
      null) as StoryRecord | null
  } catch {
    return devStories.get(genre) ?? null
  }
}

async function writeCached(genre: string, record: StoryRecord): Promise<void> {
  try {
    await store().setJSON(storyKey(genre), record)
  } catch {
    devStories = new Map(devStories).set(genre, record)
  }
}

/** Top countries with their strongest decades, from our own dataset. */
function datasetSummary(genre: string): string {
  const countries = (
    emergence as {
      genres: Record<string, Record<string, Record<string, number>>>
    }
  ).genres[genre]
  if (!countries) return '(no dataset rows)'

  const ranked = Object.entries(countries)
    .map(([code, byDecade]) => {
      const total = Object.values(byDecade).reduce((sum, n) => sum + n, 0)
      const [peakDecade, peakCount] = Object.entries(byDecade).sort(
        (a, b) => b[1] - a[1],
      )[0]
      return { code, total, peakDecade, peakCount }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)

  return ranked
    .map(
      (row) =>
        `${row.code}: ${row.total} artists emerged overall, peak ${row.peakDecade}s (${row.peakCount})`,
    )
    .join('; ')
}

const STORY_SCHEMA = {
  type: 'object',
  properties: {
    story: {
      type: 'string',
      description:
        'The 3–5 sentence story. Every artist name wrapped exactly like [[Name]].',
    },
  },
  required: ['story'],
  additionalProperties: false,
} as const

function buildPrompt(genre: string): string {
  return `Write the short origin-and-spread story of ${genre} for a music-discovery globe. Readers just switched on a "${genre}" lens showing where the genre's artists emerged, by country and decade.

Our dataset (MusicBrainz artists tagged ${genre}, bucketed by origin country and emergence decade): ${datasetSummary(genre)}

Rules:
- 3 to 5 sentences, total under 620 characters. Cover: where it emerged, key pioneer artists BY NAME, and how it spread geographically.
- PLURAL framing for origins — "among its pioneers", "key early figures" — never crown a single inventor. Where origins are contested, say so lightly and name the widely-agreed pioneers.
- Wrap every artist name exactly like [[Bob Marley]] — these become links.
- Name 3–6 pioneer/key artists you are certain belong to this genre's early story.
- Weave in one or two of the dataset numbers naturally where they help; the dataset reflects registered artists, not gospel — don't oversell it.
- Honest, plain, warm. No purple prose, no "revolutionary", no exclamation points.`
}

async function generateStory(genre: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: STORY_SCHEMA } },
      messages: [{ role: 'user', content: buildPrompt(genre) }],
    })
    if (response.stop_reason === 'refusal') return null
    const text = response.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') return null
    const parsed = JSON.parse(text.text) as { story: string }
    const story = parsed.story?.trim()
    return story && story.length >= 100 ? story.slice(0, 900) : null
  } catch (error) {
    console.error(`genre story ${genre} generation failed:`, error)
    return null
  }
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ genre: string }> },
) {
  const { genre: raw } = await ctx.params
  const genre = decodeURIComponent(raw)
  if (!isGenreLens(genre)) {
    return NextResponse.json({ error: 'Unknown genre' }, { status: 404 })
  }

  const memoized = memo.get(genre)
  if (memoized) return withCacheHeaders(NextResponse.json(memoized))

  const cached = await readCached(genre)
  if (cached) {
    memo.set(genre, cached)
    return withCacheHeaders(NextResponse.json(cached))
  }

  const story = await generateStory(genre)
  if (!story) {
    // Never cache a failure — the next visitor triggers a fresh attempt.
    return NextResponse.json({ error: 'Story unavailable' }, { status: 503 })
  }
  const record: StoryRecord = {
    story,
    model: MODEL,
    at: new Date().toISOString(),
  }
  await writeCached(genre, record)
  memo.set(genre, record)
  return withCacheHeaders(NextResponse.json(record))
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=2592000, stale-while-revalidate=604800',
  )
  return response
}
