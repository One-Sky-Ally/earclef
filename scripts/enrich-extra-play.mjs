/**
 * One-time enrichment of the committed gap-fill play dataset:
 *
 *   node scripts/enrich-extra-play.mjs [--limit N] [--dry]
 *
 * WHY (owner-approved, Aug 30 2026): lib/explore/extra-play.json holds
 * ~6.8k playability-verified YouTube videos, but stores only the URL.
 * Two things need the rest of the facts:
 *
 *  1. QUEUE TITLES — gap-fill entries can now join place+era queues via
 *     QueuePlayer's preresolved path, and a queue row reads
 *     "artist — title". Without a stored title the row is nameless.
 *  2. STANDING LESSON 7 — the sweep that built this dataset matched
 *     Discogs release videos, which anchors WHO but never WHAT: a
 *     Short, a trailer or a teaser attached to a release passes. This
 *     pass applies the same duration floor the hits sweep uses.
 *
 * Cost: videos.list is 1 unit per CALL of up to 50 ids — the whole
 * corpus is ~137 units. Cheap enough to run in one sitting.
 *
 * WRITES: title + durationSeconds onto each youtube-video entry, plus
 * queueEligible:false on those under the floor. The play link itself is
 * NOT removed — the pill's behaviour is a separate owner ruling; this
 * pass only decides what may enter a QUEUE.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DATASET = join(ROOT, 'lib', 'explore', 'extra-play.json')
/** A song is not nine seconds long — mirrors lib/play/contentGates.ts. */
const MIN_DURATION_SECONDS = 90
const BATCH = 50

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? Number(process.argv[index + 1]) : fallback
}
const LIMIT = argOf('--limit', Infinity)
const DRY = process.argv.includes('--dry')

/** Same .env.local reader the sibling sweeps use — no dotenv dep. */
function env(name) {
  if (process.env[name]) return process.env[name]
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return null
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && match[1] === name) return match[2].trim()
  }
  return null
}

const key = env('YOUTUBE_API_KEY')
if (!key) throw new Error('YOUTUBE_API_KEY missing (.env.local)')

function videoIdOf(url) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return parsed.pathname.slice(1) || null
    if (host === 'youtube.com') return parsed.searchParams.get('v')
    return null
  } catch {
    return null
  }
}

function durationSeconds(iso) {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '')
  if (!match) return 0
  const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return hours * 3600 + minutes * 60 + seconds
}

/** YouTube API titles arrive HTML-encoded; store them as plain text. */
function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function ytJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      const reason = body.error?.errors?.[0]?.reason ?? ''
      throw new Error(`YouTube 403 (${reason || 'forbidden'})`)
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
      continue
    }
    if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`)
    return res.json()
  }
  throw new Error('YouTube rate limited')
}

const dataset = JSON.parse(readFileSync(DATASET, 'utf8'))
const entries = dataset.entries

/** Only unenriched YouTube videos — reruns resume where this left off. */
const pending = []
for (const [entryKey, entry] of Object.entries(entries)) {
  if (entry.play?.kind !== 'youtube-video') continue
  if (entry.title !== undefined) continue
  const videoId = videoIdOf(entry.play.url)
  if (!videoId) {
    console.warn(`skip ${entryKey}: unparseable URL ${entry.play.url}`)
    continue
  }
  pending.push({ entryKey, videoId })
  if (pending.length >= LIMIT) break
}

console.log(`${pending.length} entries to enrich (${Math.ceil(pending.length / BATCH)} calls)`)
if (DRY) process.exit(0)

const facts = new Map()
let calls = 0
for (let index = 0; index < pending.length; index += BATCH) {
  const slice = pending.slice(index, index + BATCH)
  const ids = slice.map((item) => item.videoId).join(',')
  const body = await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids}&key=${key}`,
  )
  calls++
  for (const item of body.items ?? []) {
    facts.set(item.id, {
      title: decodeEntities(item.snippet?.title ?? ''),
      duration: durationSeconds(item.contentDetails?.duration),
      playable: Boolean(
        item.status?.embeddable && item.status.privacyStatus === 'public',
      ),
    })
  }
  if (index % (BATCH * 10) === 0) {
    console.log(`  ${Math.min(index + BATCH, pending.length)}/${pending.length}…`)
  }
}

// Immutable rebuild — never mutate the loaded entries in place.
const nextEntries = { ...entries }
const short = []
let enriched = 0
let vanished = 0
let unplayable = 0
for (const { entryKey, videoId } of pending) {
  const fact = facts.get(videoId)
  if (!fact) {
    // Absent from the response = deleted or region-blocked since the
    // sweep. Recorded, never silently kept: it cannot enter a queue.
    vanished++
    nextEntries[entryKey] = { ...entries[entryKey], queueEligible: false, gone: true }
    continue
  }
  const longEnough = fact.duration >= MIN_DURATION_SECONDS
  if (!longEnough) short.push({ entryKey, title: fact.title, duration: fact.duration })
  if (!fact.playable) unplayable++
  enriched++
  nextEntries[entryKey] = {
    ...entries[entryKey],
    title: fact.title,
    durationSeconds: fact.duration,
    ...(longEnough && fact.playable ? {} : { queueEligible: false }),
  }
}

writeFileSync(
  DATASET,
  `${JSON.stringify({ ...dataset, entries: nextEntries }, null, 2)}\n`,
)

console.log(`\nenriched: ${enriched}   API calls: ${calls}`)
console.log(`gone from YouTube: ${vanished}`)
console.log(`no longer playable: ${unplayable}`)
console.log(`under ${MIN_DURATION_SECONDS}s (queue-excluded): ${short.length}`)
for (const item of short.slice(0, 40)) {
  console.log(`  ${item.duration}s  ${item.entryKey}  ${item.title}`)
}
if (short.length > 40) console.log(`  …and ${short.length - 40} more`)
