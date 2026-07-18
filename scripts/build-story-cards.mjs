/**
 * The story-card farm: per-artist editorial cards with a hard sourcing gate.
 *
 *   node scripts/build-story-cards.mjs                  # all artists (resumable)
 *   node scripts/build-story-cards.mjs --artists a,b    # subset
 *   node scripts/build-story-cards.mjs --assemble       # work files -> lib/stories/cards.json
 *
 * Pipeline per artist (claude-opus-4-8, adaptive thinking):
 *   1. GENERATE 3-4 candidate cards, each decomposed into checkable claims
 *      with 2-3 proposed reputable sources per claim.
 *   2. FETCH every proposed source live (Wikipedia via the extracts API,
 *      others as HTML). Dead link = the source doesn't count.
 *   3. VERIFY with a second model call: per claim, which fetched sources
 *      explicitly support it (strict — unsupported wins ties).
 *   4. GATE: every claim supported by 2+ live sources -> status published.
 *      Anything less -> status draft + holdReason (owner reviews in /studio).
 *   5. MEDIA: only pre-verified video IDs from the artist's own content
 *      JSON, YouTube search URLs, or live-checked external links — a model
 *      can propose media, it can never invent a video ID into the site.
 *
 * Resumable: artists with an existing work file are skipped. Progress logs
 * to data/story-farm.log (one line per artist) for the morning report.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const ROOT = process.cwd()
const CONTENT_DIR = join(ROOT, 'content')
const WORK_DIR = join(ROOT, 'data', 'story-cards-work')
const OUT_PATH = join(ROOT, 'lib', 'stories', 'cards.json')
const LOG_PATH = join(ROOT, 'data', 'story-farm.log')
const MODEL = 'claude-opus-4-8'
const API_VERSION = '2023-06-01'
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TODAY = new Date().toISOString().slice(0, 10)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  appendFileSync(LOG_PATH, stamped + '\n')
}

// --- env -------------------------------------------------------------------

function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, '')
    }
  }
}

// --- model calls -----------------------------------------------------------

let anthropicClient = null

// Streaming via the SDK: long Opus generations (adaptive thinking) drop
// plain non-streaming fetch sockets — SSE keeps the connection alive.
async function claude(messages, schema, maxTokens) {
  anthropicClient ??= new Anthropic()
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stream = anthropicClient.messages.stream({
        model: MODEL,
        max_tokens: maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema } },
        messages,
      })
      const body = await stream.finalMessage()
      if (body.stop_reason === 'refusal') throw new Error('model refusal')
      const text = body.content.find((block) => block.type === 'text')
      if (!text) throw new Error('no text block')
      return JSON.parse(text.text)
    } catch (error) {
      if (attempt === 3) throw error
      await sleep(15000 * attempt)
    }
  }
}

const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['era', 'song', 'screen', 'collab', 'anniversary', 'performance', 'news'],
          },
          hook: { type: 'string', description: 'Headline hook, compelling but strictly true, <=120 chars, no quotation-marked quotes' },
          story: { type: 'string', description: '2-4 sentences, <=650 chars, plain and warm, no purple prose' },
          claims: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      publisher: { type: 'string' },
                      url: { type: 'string' },
                    },
                    required: ['title', 'publisher', 'url'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['claim', 'sources'],
              additionalProperties: false,
            },
          },
          media: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                kind: { type: 'string', enum: ['verifiedVideo', 'youtubeSearch', 'externalLink'] },
                videoId: { type: 'string' },
                query: { type: 'string' },
                url: { type: 'string' },
              },
              required: ['label', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['type', 'hook', 'story', 'claims', 'media'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claimIndex: { type: 'integer' },
          supportedBySourceIndexes: {
            type: 'array',
            items: { type: 'integer' },
          },
        },
        required: ['claimIndex', 'supportedBySourceIndexes'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
}

function generatePrompt(artist) {
  const videos = artist.watch?.videos ?? []
  const albums = artist.listen?.featuredAlbums ?? []
  const website = artist.hero.socials?.find((s) => s.platform === 'website')?.url
  return `You are writing "story cards" for ${artist.hero.name} on Ear Clef, a music-discovery site whose brand is ACCURACY. A story card = a clickbait-quality hook that is completely TRUE + a short story + media links.

Today's date: ${TODAY}.

Artist context (verified):
- Name: ${artist.hero.name} — ${artist.hero.identity}
- Location: ${artist.hero.location}
- Site bio: ${(artist.story?.paragraphs ?? []).join(' ').slice(0, 1500)}
- Featured albums: ${albums.map((a) => `${a.title} (${a.year ?? '?'})`).join('; ')}
- VERIFIED official videos you may reference as media (id — title): ${videos.map((v) => `${v.youtubeId} — ${v.title}`).join('; ') || 'none'}
${website ? `- Official site: ${website}` : ''}

Write 2-4 cards. Good card types: era/origin stories, the story behind a song, screen appearances (film/documentary/soundtrack), collaboration webs, anniversaries (only if the date is documented and near ${TODAY}), legendary performances, documented recent news.

HARD RULES:
1. Everything must be true and documented. NO invented quotes — never use quotation marks except around titles of works. Paraphrase documented sentiments ("he has spoken about tiring of playing it") only when that sentiment is well documented.
2. Contested histories get plural framing ("among the pioneers", "one of the first") — never crown a single inventor of anything contested.
3. Decompose each card's story into its checkable factual claims (1-5). Each claim must be ATOMIC — exactly one fact ("In Rainbows was released as a pay-what-you-want download", NOT "…and it was released in October 2007 and reshaped economics"). Composite claims fail verification. For each claim list 3 REAL text sources that genuinely document it. Sources are MACHINE-FETCHED and checked: a URL that 404s, paywalls, or does not plainly state the fact in its text does not count, and a claim needs TWO counting sources to publish. Your best bets: DISTINCT en.wikipedia.org articles (the artist page, the album page, and the song page are three separate sources — use exact URLs like https://en.wikipedia.org/wiki/OK_Computer), plus Guardian/NPR/Billboard/Pitchfork pieces you are confident exist. Never use YouTube, social media, or video pages as claim sources (those belong in media). Avoid hard-paywalled outlets (NYT, The Times, WSJ).
4. Media per card (1-2): either kind "verifiedVideo" with a videoId FROM THE LIST ABOVE ONLY, or kind "youtubeSearch" with a search query (e.g. "Radiohead Creep live Glastonbury 2009"), or kind "externalLink" with a URL you are certain is official and live. Never invent a YouTube video ID.
5. Hooks: specific and irresistible but never overpromising. "The song X got sick of playing" style — only if true.
6. Precision about attribution: whose show/award/record was it? Playing at someone else's sold-out show is not selling it out yourself; a featured credit is not a lead single. Overreach fails verification.`
}

/**
 * Per-claim retrieval: keyword-scored windows from ONE source for ONE
 * claim, so the verifier reads the paragraph about the claim instead of
 * the first N chars of a 60k-char article.
 */
function claimExcerpt(text, claim, cap = 2600) {
  const terms = new Set()
  for (const match of claim.matchAll(/[A-Z][\w'.-]+|\d{4}|[a-z]{4,}/g)) {
    const term = match[0].toLowerCase()
    if (term.length >= 4) terms.add(term)
  }
  const windows = []
  for (let start = 0; start < text.length; start += 650) {
    const chunk = text.slice(start, start + 800)
    const lower = chunk.toLowerCase()
    let score = 0
    for (const term of terms) if (lower.includes(term)) score++
    windows.push({ start, chunk, score })
  }
  const picked = windows
    .filter((w) => w.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.start - b.start)
  const parts = [text.slice(0, 400)]
  let total = parts[0].length
  for (const w of picked) {
    if (w.start < 400) continue
    if (total + w.chunk.length > cap) break
    parts.push(w.chunk)
    total += w.chunk.length
  }
  return parts.join('\n[...]\n')
}

function verifyPrompt(artistName, cards, sourceTexts) {
  const byUrl = new Map(sourceTexts.map((s, i) => [s.url, { ...s, index: i }]))
  const flat = cards.flatMap((card) =>
    card.claims.map((c) => ({
      claim: c.claim,
      urls: c.sources.map((s) => s.url),
    })),
  )
  const blocks = flat.map((entry, i) => {
    const lines = [`CLAIM ${i}: ${entry.claim}`]
    for (const url of entry.urls) {
      const source = byUrl.get(url)
      if (!source) continue
      lines.push(
        `SOURCE ${source.index} (${source.url}) excerpt:\n${claimExcerpt(source.text, entry.claim)}`,
      )
    }
    return lines.join('\n\n')
  })
  return `You are a strict fact-checker for a music site. Below are claims about ${artistName}. Under each claim are keyword-selected excerpts from the sources proposed for it (excerpts of larger pages — judge only from the text shown). For each claim, list the indexes of sources whose excerpt EXPLICITLY STATES or directly entails the claim. Be strict: partial or vague support does not count. A claim with an empty list is fine — accuracy beats generosity.

${blocks.join('\n\n=====\n\n')}`
}

// --- source fetching -------------------------------------------------------

const sourceCache = new Map()

async function wikiExtract(title) {
  // Rendered HTML, not the extracts API: extracts drop TABLES, and award/
  // chart facts live in tables. Stripped HTML keeps them as text.
  const api = `https://en.wikipedia.org/w/api.php?action=parse&prop=text&redirects=1&format=json&page=${encodeURIComponent(title)}`
  const res = await fetch(api, { headers: { 'User-Agent': 'EarClefStories/0.1 (fiohmemorial@gmail.com)' } })
  if (!res.ok) return null
  const body = await res.json()
  const html = body?.parse?.text?.['*']
  if (!html) return null
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200000)
}

async function fetchSourceText(url) {
  if (sourceCache.has(url)) return sourceCache.get(url)
  let result = null
  try {
    const wiki = url.match(/^https?:\/\/en\.wikipedia\.org\/wiki\/(.+)$/)
    if (wiki) {
      const title = decodeURIComponent(wiki[1]).split('#')[0].replace(/_/g, ' ')
      let text = await wikiExtract(title)
      if (!text) {
        // Slightly-wrong guessed titles are common — rescue via search.
        await sleep(400)
        const search = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json`,
          { headers: { 'User-Agent': 'EarClefStories/0.1 (fiohmemorial@gmail.com)' } },
        )
        if (search.ok) {
          const found = (await search.json())?.query?.search?.[0]?.title
          if (found) {
            await sleep(400)
            text = await wikiExtract(found)
          }
        }
      }
      if (text) result = { url, text }
    } else {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        const html = await res.text()
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&\w+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text.length > 500) result = { url, text: text.slice(0, 30000) }
      }
    }
  } catch {
    result = null
  }
  sourceCache.set(url, result)
  await sleep(900)
  return result
}

// --- media resolution ------------------------------------------------------

function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

async function resolveMedia(media, artist) {
  const verifiedIds = new Set((artist.watch?.videos ?? []).map((v) => v.youtubeId))
  const resolved = []
  for (const item of media ?? []) {
    const label = (item.label ?? '').slice(0, 90)
    if (!label) continue
    if (item.kind === 'verifiedVideo' && item.videoId && verifiedIds.has(item.videoId)) {
      resolved.push({ label, url: `https://www.youtube.com/watch?v=${item.videoId}` })
    } else if (item.kind === 'verifiedVideo' && item.videoId) {
      // Not one of ours — degrade to a search, never trust a model-minted ID.
      resolved.push({ label, url: youtubeSearchUrl(`${artist.hero.name} ${label}`) })
    } else if (item.kind === 'youtubeSearch' && item.query) {
      resolved.push({ label, url: youtubeSearchUrl(item.query) })
    } else if (item.kind === 'externalLink' && item.url && /^https:\/\//.test(item.url)) {
      try {
        const res = await fetch(item.url, {
          headers: { 'User-Agent': BROWSER_UA },
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) resolved.push({ label, url: item.url })
      } catch {
        // dead link — dropped
      }
      await sleep(700)
    }
  }
  return resolved.slice(0, 2)
}

// --- per-artist run --------------------------------------------------------

function cardId(slug, hook) {
  let hash = 5381
  for (const char of hook) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  return `${slug}-${hash.toString(16)}`
}

async function farmArtist(slug) {
  const artist = JSON.parse(readFileSync(join(CONTENT_DIR, `${slug}.json`), 'utf8'))

  const generated = await claude(
    [{ role: 'user', content: generatePrompt(artist) }],
    GENERATE_SCHEMA,
    9000,
  )
  const candidates = (generated.cards ?? []).slice(0, 4)

  // Fetch every unique proposed source once.
  const urls = [...new Set(candidates.flatMap((card) => card.claims.flatMap((c) => c.sources.map((s) => s.url))))]
  const fetched = []
  for (const url of urls) {
    const text = await fetchSourceText(url)
    if (text) fetched.push(text)
  }
  const liveByUrl = new Map(fetched.map((s, i) => [s.url, i]))

  // One verify call covering all cards' claims against all live sources.
  const flatClaims = candidates.flatMap((card, cardIndex) =>
    card.claims.map((c) => ({ cardIndex, claim: c.claim, proposed: c.sources })),
  )
  let verified = { results: [] }
  if (fetched.length > 0 && flatClaims.length > 0) {
    verified = await claude(
      [{ role: 'user', content: verifyPrompt(artist.hero.name, candidates, fetched) }],
      VERIFY_SCHEMA,
      6000,
    )
  }
  const supportByClaim = new Map(
    (verified.results ?? []).map((r) => [r.claimIndex, new Set(r.supportedBySourceIndexes ?? [])]),
  )

  const cards = []
  for (const [cardIndex, candidate] of candidates.entries()) {
    const holdReasons = []
    const usedSources = new Map()
    const claimReport = []

    candidate.claims.forEach((claimSpec, localIndex) => {
      const globalIndex = flatClaims.findIndex(
        (f) => f.cardIndex === cardIndex && f.claim === claimSpec.claim,
      )
      const supported = supportByClaim.get(globalIndex) ?? new Set()
      // Count only sources that are BOTH live and verifier-confirmed.
      const confirmed = claimSpec.sources.filter((s) => {
        const liveIndex = liveByUrl.get(s.url)
        return liveIndex !== undefined && supported.has(liveIndex)
      })
      if (confirmed.length < 2) {
        const liveCount = claimSpec.sources.filter((s) => liveByUrl.has(s.url)).length
        holdReasons.push(
          `claim ${localIndex + 1} ("${claimSpec.claim.slice(0, 90)}…") confirmed by ${confirmed.length}/2 required sources (${liveCount} live)`,
        )
      }
      for (const s of confirmed) usedSources.set(s.url, s)
      // Sources shown on a card are only ones that actually back it.
      claimReport.push({
        claim: claimSpec.claim,
        proposed: claimSpec.sources.map((s) => ({
          url: s.url,
          live: liveByUrl.has(s.url),
          supported: confirmed.some((c) => c.url === s.url),
        })),
      })
    })

    const media = await resolveMedia(candidate.media, artist)
    const hook = candidate.hook.slice(0, 160)
    const story = candidate.story.slice(0, 700)
    const sources = [...usedSources.values()].map((s) => ({
      title: s.title.slice(0, 160),
      publisher: s.publisher.slice(0, 60),
      url: s.url,
    }))

    // Absolute floor even for drafts: something checkable must exist.
    if (sources.length === 0 && holdReasons.length === 0) {
      holdReasons.push('no live sources survived fetching')
    }

    cards.push({
      id: cardId(slug, hook),
      slug,
      artistName: artist.hero.name,
      type: candidate.type,
      hook,
      story,
      media,
      sources,
      status: holdReasons.length === 0 ? 'published' : 'draft',
      ...(holdReasons.length > 0 ? { holdReason: holdReasons.join('; ') } : {}),
      model: MODEL,
      at: new Date().toISOString(),
      claimReport,
    })
  }

  writeFileSync(
    join(WORK_DIR, `${slug}.json`),
    JSON.stringify({ slug, generatedAt: new Date().toISOString(), cards }, null, 2),
  )
  const published = cards.filter((c) => c.status === 'published').length
  const drafts = cards.length - published
  log(`${slug}: ${published} published, ${drafts} draft${drafts === 1 ? '' : 's'}`)
  return { published, drafts }
}

// --- assemble --------------------------------------------------------------

function assemble() {
  const files = existsSync(WORK_DIR)
    ? readdirSync(WORK_DIR).filter((f) => f.endsWith('.json')).sort()
    : []
  const cards = files
    .flatMap((file) => JSON.parse(readFileSync(join(WORK_DIR, file), 'utf8')).cards)
    // Gate detail stays in the work files; the shipped file is lean.
    .map(({ claimReport, ...card }) => card)
  writeFileSync(OUT_PATH, JSON.stringify({ version: 1, cards }, null, 2) + '\n')
  const published = cards.filter((c) => c.status === 'published').length
  console.log(`assembled ${cards.length} cards (${published} published, ${cards.length - published} draft) -> lib/stories/cards.json`)
}

// --- main ------------------------------------------------------------------

loadEnv()
mkdirSync(WORK_DIR, { recursive: true })

if (process.argv.includes('--assemble')) {
  assemble()
  process.exit(0)
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing (checked env + .env.local)')
  process.exit(1)
}

const artistsArg = process.argv.indexOf('--artists')
const requested =
  artistsArg !== -1
    ? process.argv[artistsArg + 1].split(',')
    : readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))

const pending = requested.filter((slug) => !existsSync(join(WORK_DIR, `${slug}.json`)))
log(`farm start: ${pending.length} of ${requested.length} artists pending`)

let totals = { published: 0, drafts: 0, failed: 0 }
for (const slug of pending) {
  try {
    const result = await farmArtist(slug)
    totals = {
      ...totals,
      published: totals.published + result.published,
      drafts: totals.drafts + result.drafts,
    }
  } catch (error) {
    totals = { ...totals, failed: totals.failed + 1 }
    log(`${slug}: FAILED — ${error.message}`)
  }
  await sleep(3000)
}
log(`farm done: ${totals.published} published, ${totals.drafts} drafts, ${totals.failed} failed`)
assemble()
