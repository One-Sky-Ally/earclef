/**
 * LOCAL feed-blurb warmer — runs in Claude Code on the owner's plan, so
 * blurbs cost nothing from the API wallet. The live blurbs route is
 * serve-from-cache only; this script is the only generator.
 *
 *   node scripts/warm-blurbs.mjs                # warm the whole live feed
 *   node scripts/warm-blurbs.mjs --slug <slug>  # only one artist's items
 *   node scripts/warm-blurbs.mjs --dry          # report misses, no model
 *
 * Flow: read the production feed snapshot → ask the (cache-only) blurbs
 * route which items lack blurbs → generate the missing ones via the
 * `claude` CLI (subscription auth, Haiku) using the same prompt rules the
 * server used to → seed them through the owner-gated
 * /api/studio/seed-blurbs endpoint. Needs OWNER_KEY in .env.local.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SITE = process.env.EARCLEF_SITE ?? 'https://earclef.com'
const MODEL = 'claude-haiku-4-5'
const BATCH = 10

// --- key derivation: EXACT port of lib/feed/blurbKey.ts ---------------------

function normalizedTitle(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special)[^)\]]*[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

const blurbKey = (slug, type, title) =>
  `v2/${slug}/${type}/${normalizedTitle(title) || 'untitled'}`

// --- env --------------------------------------------------------------------

function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, '')
    }
  }
}

// --- claude CLI (subscription-billed) ---------------------------------------

function claudeCli(prompt) {
  const out = execFileSync('claude', ['-p', '--model', MODEL, '--output-format', 'text'], {
    input: prompt,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const jsonMatch = out.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('no JSON in CLI output')
  return JSON.parse(jsonMatch[0])
}

function buildPrompt(items) {
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

Respond with ONLY a JSON object, no prose, in exactly this shape:
{"blurbs": [{"key": "<the key>", "text": "<the blurb>"}, ...]}

Items:
${lines}`
}

// --- main -------------------------------------------------------------------

loadEnv()
const dry = process.argv.includes('--dry')
const slugArg = process.argv.indexOf('--slug')
const onlySlug = slugArg !== -1 ? process.argv[slugArg + 1] : null

if (!dry && !process.env.OWNER_KEY) {
  console.error('OWNER_KEY missing (checked env + .env.local)')
  process.exit(1)
}

const snapshotRes = await fetch(`${SITE}/api/feed/snapshot`)
if (!snapshotRes.ok) {
  console.error(`feed snapshot unavailable (HTTP ${snapshotRes.status}) — deploy first or wait for the nightly build`)
  process.exit(1)
}
const { items } = await snapshotRes.json()
// The feed renders only the newest ~50 (plus tier-filtered views) — warm
// the plausibly-visible window, not the deep catalog. --all overrides.
const VISIBLE_WINDOW = 80
const all = process.argv.includes('--all')
const wanted = items
  .filter((item) => (onlySlug ? item.slug === onlySlug : true))
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, onlySlug || all ? items.length : VISIBLE_WINDOW)
console.log(`${wanted.length} feed items${onlySlug ? ` for ${onlySlug}` : ''}`)

// Ask the cache-only route which keys are already warm.
const misses = []
for (let i = 0; i < wanted.length; i += 12) {
  const chunk = wanted.slice(i, i + 12)
  const res = await fetch(`${SITE}/api/feed/blurbs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: chunk.map((item) => ({
        slug: item.slug,
        artistName: item.artistName,
        title: item.title,
        type: item.type,
        date: item.date,
      })),
    }),
  })
  const body = res.ok ? await res.json() : { blurbs: {} }
  for (const item of chunk) {
    if (!(blurbKey(item.slug, item.type, item.title) in (body.blurbs ?? {}))) {
      misses.push(item)
    }
  }
  await new Promise((r) => setTimeout(r, 300))
}
// The same normalized key can appear twice (MB + iTunes variants) — once is enough.
const seen = new Set()
const unique = misses.filter((item) => {
  const key = blurbKey(item.slug, item.type, item.title)
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
console.log(`${unique.length} blurbs missing`)
if (dry || unique.length === 0) process.exit(0)

let seeded = 0
for (let i = 0; i < unique.length; i += BATCH) {
  const chunk = unique.slice(i, i + BATCH)
  try {
    const parsed = claudeCli(buildPrompt(chunk))
    const valid = new Set(chunk.map((item) => blurbKey(item.slug, item.type, item.title)))
    const blurbs = {}
    for (const b of parsed.blurbs ?? []) {
      if (valid.has(b.key) && typeof b.text === 'string') blurbs[b.key] = b.text
    }
    if (Object.keys(blurbs).length === 0) continue
    const res = await fetch(`${SITE}/api/studio/seed-blurbs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-owner-key': process.env.OWNER_KEY,
      },
      body: JSON.stringify({ blurbs, model: `${MODEL} (local)` }),
    })
    const body = res.ok ? await res.json() : {}
    seeded += body.written ?? 0
    console.log(`batch ${i / BATCH + 1}: seeded ${body.written ?? 0}/${chunk.length}`)
  } catch (error) {
    console.error(`batch ${i / BATCH + 1} failed: ${error.message}`)
  }
}
console.log(`done: ${seeded} blurbs seeded`)
