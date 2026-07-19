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
import { execFileSync } from 'node:child_process'
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
// Two billing paths:
//   claude CLI (default when installed) — the owner's Claude subscription;
//   Anthropic API (fallback, or FORCE_API=1) — the pay-as-you-go wallet.

function cliAvailable() {
  if (process.env.FORCE_API === '1') return false
  try {
    execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

const USE_CLI = cliAvailable()

function claudeViaCli(messages, schema, attempt = 1) {
  const prompt = `${messages[0].content}

Respond with ONLY a single JSON object (no prose, no code fences) that validates against this JSON Schema:
${JSON.stringify(schema)}`
  const out = execFileSync(
    'claude',
    ['-p', '--model', MODEL, '--output-format', 'text'],
    { input: prompt, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 },
  )
  const jsonMatch = out.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    if (attempt < 2) return claudeViaCli(messages, schema, attempt + 1)
    throw new Error('no JSON in CLI output')
  }
  try {
    return JSON.parse(jsonMatch[0])
  } catch (error) {
    if (attempt < 2) return claudeViaCli(messages, schema, attempt + 1)
    throw error
  }
}

async function claude(messages, schema, maxTokens) {
  if (USE_CLI) return claudeViaCli(messages, schema)
  return claudeViaApi(messages, schema, maxTokens)
}

async function claudeViaApi(messages, schema, maxTokens) {
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
      if (!text) {
        // Adaptive thinking can burn the whole budget on hard batches —
        // retry once with double the room before giving up.
        if (body.stop_reason === 'max_tokens' && maxTokens < 64000) {
          return claudeViaApi(messages, schema, maxTokens * 2)
        }
        throw new Error(`no text block (stop_reason: ${body.stop_reason})`)
      }
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
                kind: {
                  type: 'string',
                  enum: ['hard', 'soft'],
                  description:
                    'hard = database-style fact (birthplace, membership, discography, release year, screen role, award, feature credit); soft = interpretive/anecdotal (sentiments, motivations, single-interview stories)',
                },
                core: {
                  type: 'boolean',
                  description: 'true if the hook rests on this claim',
                },
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
              required: ['claim', 'kind', 'core', 'sources'],
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
0. FACT SELECTION DEFAULT: pull only clearly-true, easily-verifiable facts — the kind found in liner notes, Wikipedia, AllMusic, and official sources. Prioritize hard facts (membership, discography, awards, film/TV placements, documented collaborations and features, chart records) over interpretive stories, anecdotes, or single-interview quotes. When a fact is solid but one detail is shaky, state the solid fact and OMIT the shaky detail — never sacrifice the card for a garnish, and never hedge.
1. Everything must be true and documented. NO invented quotes — never use quotation marks except around titles of works. Paraphrase documented sentiments ("he has spoken about tiring of playing it") only when that sentiment is well documented.
2. Contested histories get plural framing ("among the pioneers", "one of the first") — never crown a single inventor of anything contested.
3. Decompose each card's story into its checkable factual claims (1-5). Each claim must be ATOMIC — exactly one fact ("In Rainbows was released as a pay-what-you-want download", NOT "…and it was released in October 2007 and reshaped economics"). Composite claims fail verification. For each claim list 3 REAL text sources that genuinely document it. Sources are MACHINE-FETCHED and checked: a URL that 404s, paywalls, or does not plainly state the fact in its text does not count, and a claim needs TWO counting sources to publish. Your best bets: DISTINCT en.wikipedia.org articles (the artist page, the album page, and the song page are three separate sources — use exact URLs like https://en.wikipedia.org/wiki/OK_Computer), plus Guardian/NPR/Billboard/Pitchfork pieces you are confident exist. Never use YouTube, social media, or video pages as claim sources (those belong in media). Avoid hard-paywalled outlets (NYT, The Times, WSJ).
4. Media per card (1-2): either kind "verifiedVideo" with a videoId FROM THE LIST ABOVE ONLY, or kind "youtubeSearch" with a search query (e.g. "Radiohead Creep live Glastonbury 2009"), or kind "externalLink" with a URL you are certain is official and live. Never invent a YouTube video ID.
5. Hooks: specific and irresistible but never overpromising. "The song X got sick of playing" style — only if true.
6. Precision about attribution: whose show/award/record was it? Playing at someone else's sold-out show is not selling it out yourself; a featured credit is not a lead single. Overreach fails verification.
7. Tag every claim: kind "hard" for database-style facts (birthplace, band membership, discography, release years, film/TV roles, awards, documented feature credits) or "soft" for interpretive/anecdotal material (sentiments, motivations, single-interview stories). Mark core=true on the claim(s) the hook rests on. Hard facts verify against Wikipedia plus structured databases; soft claims need two independent prose sources — so a card whose CORE is soft needs its strongest sourcing.`
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

function verifyPrompt(artistName, cards, sourceTexts, structuredText) {
  const byUrl = new Map(sourceTexts.map((s, i) => [s.url, { ...s, index: i }]))
  const structuredIndex = sourceTexts.length
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
  const structuredBlock = structuredText
    ? `\n\nSOURCE ${structuredIndex} is the artist's MusicBrainz DATABASE RECORD (applies to every claim; list index ${structuredIndex} for any claim whose fact the record directly evidences — a release title with its first-release date, membership relation, origin area, life-span, official link):\n${structuredText.slice(0, 14000)}`
    : ''
  return `You are a strict fact-checker for a music site. Below are claims about ${artistName}. Under each claim are keyword-selected excerpts from the sources proposed for it (excerpts of larger pages — judge only from the text shown). For each claim, list the indexes of sources whose excerpt EXPLICITLY STATES or directly entails the claim. Be strict: partial or vague support does not count. A claim with an empty list is fine — accuracy beats generosity.${structuredBlock}

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

// --- structured source (MusicBrainz) ---------------------------------------

/**
 * The artist's MusicBrainz record, trimmed to the fields that settle hard
 * facts: identity, origin, life-span, membership relations, discography
 * with first-release dates, official links. Hard facts live in databases,
 * not prose — this is the second leg of the hard-fact verification tier.
 */
async function mbStructured(artist) {
  const mbid = artist.integrations?.setlistfm?.mbid
  if (!mbid) return null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `https://musicbrainz.org/ws/2/artist/${mbid}?inc=release-groups+url-rels+artist-rels+aliases&fmt=json`,
        { headers: { 'User-Agent': 'EarClefStories/0.1 (fiohmemorial@gmail.com)' } },
      )
      if (res.status === 503 || res.status === 429) {
        await sleep(2500 * attempt)
        continue
      }
      if (!res.ok) return null
      const body = await res.json()
      return JSON.stringify({
        name: body.name,
        type: body.type,
        area: body.area?.name,
        beginArea: body['begin-area']?.name,
        lifeSpan: body['life-span'],
        aliases: (body.aliases ?? []).map((a) => a.name).slice(0, 12),
        releaseGroups: (body['release-groups'] ?? [])
          .map((rg) => ({
            title: rg.title,
            firstRelease: rg['first-release-date'],
            type: rg['primary-type'],
          }))
          .slice(0, 150),
        relations: (body.relations ?? [])
          .map((r) => ({
            type: r.type,
            direction: r.direction,
            artist: r.artist?.name,
            url: r.url?.resource,
          }))
          .slice(0, 80),
      })
    } catch {
      if (attempt === 3) return null
      await sleep(2500 * attempt)
    }
  }
  return null
}

const REVISE_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: 'Revised hook, only if the original asserted a dropped detail' },
    story: { type: 'string', description: 'Revised story asserting only verified content' },
  },
  required: ['story'],
  additionalProperties: false,
}

/** Drop/soften unverified incidental details instead of holding the card. */
async function reviseCard(candidate, failingClaims) {
  const revision = await claude(
    [
      {
        role: 'user',
        content: `This story card is publishable EXCEPT that the following incidental claims could not be verified:\n${failingClaims.map((c) => `- ${c}`).join('\n')}\n\nHook: ${candidate.hook}\nStory: ${candidate.story}\n\nRewrite the story to DROP or clearly soften those unverified details (softening means hedged framing like "reportedly" is NOT allowed — either drop the detail or restate it in a way that no longer asserts the unverified part). Do not add any new facts. Keep the length and tone. Revise the hook only if it asserted a dropped detail.`,
      },
    ],
    REVISE_SCHEMA,
    3000,
  )
  return revision
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

  // One verify call covering all cards' claims against all live sources,
  // plus the MusicBrainz record as a structured source for hard facts.
  const structured = await mbStructured(artist)
  const structuredIndex = fetched.length
  const flatClaims = candidates.flatMap((card, cardIndex) =>
    card.claims.map((c) => ({ cardIndex, claim: c.claim, proposed: c.sources })),
  )
  let verified = { results: [] }
  if ((fetched.length > 0 || structured) && flatClaims.length > 0) {
    verified = await claude(
      [
        {
          role: 'user',
          content: verifyPrompt(artist.hero.name, candidates, fetched, structured),
        },
      ],
      VERIFY_SCHEMA,
      6000,
    )
  }
  const supportByClaim = new Map(
    (verified.results ?? []).map((r) => [r.claimIndex, new Set(r.supportedBySourceIndexes ?? [])]),
  )
  const wikiIndexes = new Set(
    fetched.flatMap((s, i) => (/en\.wikipedia\.org/.test(s.url) ? [i] : [])),
  )
  const mbid = artist.integrations?.setlistfm?.mbid
  const mbSource = mbid
    ? {
        title: `${artist.hero.name} — MusicBrainz record`,
        publisher: 'MusicBrainz',
        url: `https://musicbrainz.org/artist/${mbid}`,
      }
    : null

  const cards = []
  for (const [cardIndex, candidate] of candidates.entries()) {
    const holdReasons = []
    const incidentalFails = []
    const usedSources = new Map()
    const claimReport = []
    let structuredUsed = false

    candidate.claims.forEach((claimSpec, localIndex) => {
      const globalIndex = flatClaims.findIndex(
        (f) => f.cardIndex === cardIndex && f.claim === claimSpec.claim,
      )
      const supported = supportByClaim.get(globalIndex) ?? new Set()
      // Sources that are BOTH live and verifier-confirmed.
      const confirmed = claimSpec.sources.filter((s) => {
        const liveIndex = liveByUrl.get(s.url)
        return liveIndex !== undefined && supported.has(liveIndex)
      })
      // Two verification tiers:
      //   soft  — 2+ confirmed prose sources (strict bar stays)
      //   hard  — database-style fact: one confirmed Wikipedia source AND
      //           the MusicBrainz structured record agreeing is sufficient
      const wikiOk = confirmed.some(
        (s) => supported.has(liveByUrl.get(s.url)) && /en\.wikipedia\.org/.test(s.url),
      ) || [...supported].some((i) => wikiIndexes.has(i))
      const structuredOk = Boolean(structured) && supported.has(structuredIndex)
      const hard = claimSpec.kind === 'hard'
      const passed =
        confirmed.length >= 2 || (hard && wikiOk && structuredOk)
      if (passed && hard && structuredOk && confirmed.length < 2) {
        structuredUsed = true
      }
      if (!passed) {
        const label = `claim ${localIndex + 1} ("${claimSpec.claim.slice(0, 90)}…") ${claimSpec.kind ?? 'soft'}/${claimSpec.core ? 'core' : 'incidental'}: ${confirmed.length}/2 prose sources${hard ? `, structured ${structuredOk ? 'agrees but no Wikipedia confirm' : 'does not confirm'}` : ''}`
        if (claimSpec.core) holdReasons.push(label)
        else incidentalFails.push({ label, claim: claimSpec.claim })
      }
      for (const s of confirmed) usedSources.set(s.url, s)
      claimReport.push({
        claim: claimSpec.claim,
        kind: claimSpec.kind,
        core: claimSpec.core,
        passed,
        proposed: claimSpec.sources.map((s) => ({
          url: s.url,
          live: liveByUrl.has(s.url),
          supported: confirmed.some((c) => c.url === s.url),
        })),
        structuredOk,
      })
    })

    const media = await resolveMedia(candidate.media, artist)
    let hook = candidate.hook.slice(0, 160)
    let story = candidate.story.slice(0, 700)

    // Incidental failures don't hold a card — the detail gets dropped.
    if (holdReasons.length === 0 && incidentalFails.length > 0) {
      try {
        const revision = await reviseCard(candidate, incidentalFails.map((f) => f.claim))
        story = revision.story.slice(0, 700)
        if (revision.hook) hook = revision.hook.slice(0, 160)
      } catch {
        // Revision failed — fall back to holding rather than shipping
        // a story that asserts unverified details.
        holdReasons.push(...incidentalFails.map((f) => f.label))
      }
    }

    const sources = [...usedSources.values()].map((s) => ({
      title: s.title.slice(0, 160),
      publisher: s.publisher.slice(0, 60),
      url: s.url,
    }))
    if (structuredUsed && mbSource && holdReasons.length === 0) {
      sources.push(mbSource)
    }

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
    // Review-rejected cards stay in the work files only.
    .filter((card) => card.status !== 'rejected')
    // Gate detail stays in the work files; the shipped file is lean.
    .map(({ claimReport, reviewCut, reviewedAt, rescoredAt, ...card }) => card)
  writeFileSync(OUT_PATH, JSON.stringify({ version: 1, cards }, null, 2) + '\n')
  const published = cards.filter((c) => c.status === 'published').length
  console.log(`assembled ${cards.length} cards (${published} published, ${cards.length - published} draft) -> lib/stories/cards.json`)
}

// --- rescore: re-gate existing drafts under the two-tier rules -------------

const RESCORE_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cardIndex: { type: 'integer' },
          decision: { type: 'string', enum: ['publish', 'hold'] },
          usedStructuredTier: { type: 'boolean' },
          revisedHook: { type: 'string' },
          revisedStory: { type: 'string' },
          holdReason: { type: 'string', description: 'Required when decision is hold: why the CORE claim is unverified' },
        },
        required: ['cardIndex', 'decision', 'usedStructuredTier'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

function rescorePrompt(artist, structured, drafts) {
  const facts = {
    name: artist.hero.name,
    location: artist.hero.location,
    featuredAlbums: artist.listen?.featuredAlbums ?? [],
    verifiedVideos: (artist.watch?.videos ?? []).map((v) => v.title),
    bio: (artist.story?.paragraphs ?? []).join(' ').slice(0, 1200),
  }
  const cardsBlock = drafts
    .map((entry) => {
      const claims = entry.card.claimReport
        .map((cr, i) => {
          const wikiSupported = cr.proposed.some(
            (p) => p.supported && /en\.wikipedia\.org/.test(p.url),
          )
          const confirmedCount = cr.proposed.filter((p) => p.supported).length
          return `  claim ${i}: ${cr.claim} [previously: ${confirmedCount} prose source(s) confirmed${wikiSupported ? ', incl. Wikipedia' : ', Wikipedia did NOT confirm'}]`
        })
        .join('\n')
      return `CARD ${entry.index}\nhook: ${entry.card.hook}\nstory: ${entry.card.story}\n${claims}`
    })
    .join('\n\n')
  return `You are re-scoring held story cards about ${facts.name} for a music site under a corrected two-tier verification policy.

STRUCTURED DATA — the artist's MusicBrainz database record:
${structured ? structured.slice(0, 14000) : '(no MusicBrainz record available)'}

STRUCTURED DATA — the site's own verified artist facts (IDs and content were human-verified against live sources):
${JSON.stringify(facts)}

POLICY:
- HARD FACTS (birthplace/origin, band membership, discography and release years, film/TV roles, awards, documented feature credits) are database facts. A hard claim is VERIFIED if a Wikipedia source previously confirmed it (see each claim's bracket) AND the structured data above agrees with it. Be conservative: the structured data must actually contain the fact (a release title + year, a membership relation, an origin area…). If the structured data doesn't cover it (e.g. most awards), the claim stays unverified under this tier.
- SOFT CLAIMS (interpretive/anecdotal: sentiments, motivations, single-interview stories, "the song that made them quit") keep the strict bar: 2+ previously-confirmed prose sources. None of these drafts met that, so an unverified soft claim stays unverified.
- CORE vs INCIDENTAL: identify the claim(s) the hook rests on. PUBLISH a card when its core claim(s) are verified (either tier). If incidental claims remain unverified, provide revisedStory (and revisedHook only if the hook asserted the dropped detail) that DROPS or restates those details so nothing unverified is asserted — never hedge with "reportedly", never add new facts. HOLD only when a core claim itself is unverified, with a holdReason saying which core claim and why.

${cardsBlock}`
}

async function rescoreArtist(slug) {
  const workPath = join(WORK_DIR, `${slug}.json`)
  const work = JSON.parse(readFileSync(workPath, 'utf8'))
  const drafts = work.cards
    .map((card, index) => ({ card, index }))
    // Resumable: cards already judged under the two-tier rules are final.
    .filter((entry) => entry.card.status === 'draft' && !entry.card.rescoredAt)
  if (drafts.length === 0) return { promoted: 0, held: 0 }

  const artist = JSON.parse(readFileSync(join(CONTENT_DIR, `${slug}.json`), 'utf8'))
  const structured = await mbStructured(artist)
  await sleep(1200)

  const result = await claude(
    [{ role: 'user', content: rescorePrompt(artist, structured, drafts) }],
    RESCORE_SCHEMA,
    20000,
  )

  const mbid = artist.integrations?.setlistfm?.mbid
  let promoted = 0
  for (const verdict of result.cards ?? []) {
    const entry = drafts.find((d) => d.index === verdict.cardIndex)
    if (!entry) continue
    const card = work.cards[entry.index]
    if (verdict.decision === 'publish') {
      promoted += 1
      card.status = 'published'
      delete card.holdReason
      if (verdict.revisedHook) card.hook = verdict.revisedHook.slice(0, 160)
      if (verdict.revisedStory) card.story = verdict.revisedStory.slice(0, 700)
      if (verdict.usedStructuredTier && mbid) {
        const url = `https://musicbrainz.org/artist/${mbid}`
        if (!card.sources.some((s) => s.url === url)) {
          card.sources.push({
            title: `${artist.hero.name} — MusicBrainz record`,
            publisher: 'MusicBrainz',
            url,
          })
        }
      }
      card.rescoredAt = new Date().toISOString()
    } else {
      card.holdReason = (verdict.holdReason ?? card.holdReason ?? 'soft core claim below the 2-source bar').slice(0, 400)
      card.rescoredAt = new Date().toISOString()
    }
  }
  writeFileSync(workPath, JSON.stringify(work, null, 2))
  const held = drafts.length - promoted
  log(`rescore ${slug}: ${promoted} promoted, ${held} still held`)
  return { promoted, held }
}

async function rescoreAll() {
  const files = readdirSync(WORK_DIR).filter((f) => f.endsWith('.json')).sort()
  let totals = { promoted: 0, held: 0, failed: 0 }
  for (const file of files) {
    const slug = file.slice(0, -5)
    try {
      const result = await rescoreArtist(slug)
      totals = {
        ...totals,
        promoted: totals.promoted + result.promoted,
        held: totals.held + result.held,
      }
    } catch (error) {
      totals = { ...totals, failed: totals.failed + 1 }
      log(`rescore ${slug}: FAILED — ${error.message}`)
    }
    await sleep(1500)
  }
  log(`rescore done: ${totals.promoted} promoted, ${totals.held} still held, ${totals.failed} artists failed`)
  assemble()
}

// --- main ------------------------------------------------------------------

loadEnv()
mkdirSync(WORK_DIR, { recursive: true })

if (process.argv.includes('--assemble')) {
  assemble()
  process.exit(0)
}

if (!USE_CLI && !process.env.ANTHROPIC_API_KEY) {
  console.error('Neither the claude CLI (subscription) nor ANTHROPIC_API_KEY (wallet) is available')
  process.exit(1)
}
log(`model path: ${USE_CLI ? 'claude CLI (subscription)' : 'Anthropic API (wallet)'}`)

if (process.argv.includes('--rescore')) {
  const only = process.argv.indexOf('--artists')
  if (only !== -1) {
    for (const slug of process.argv[only + 1].split(',')) {
      try {
        await rescoreArtist(slug)
      } catch (error) {
        log(`rescore ${slug}: FAILED — ${error.message}`)
      }
      await sleep(1500)
    }
    assemble()
  } else {
    await rescoreAll()
  }
  process.exit(0)
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
