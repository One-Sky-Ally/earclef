/**
 * Validator for the vetted-archival tier — the ONLY automation allowed
 * near it, and it only VALIDATES, never discovers or writes:
 *
 *   node scripts/validate-archival.mjs
 *
 * For every mapping in lib/play/archival-links.json it checks:
 *   1. the video is public and embeddable (YouTube videos.list), and
 *   2. the video actually sits on the allowlisted channel claimed —
 *      a mapping pointing at an unlisted channel FAILS, which is the
 *      structural stop against name-match garbage sneaking in as
 *      "archival": there is no matching step to fool, only membership.
 *
 * Exit code 1 on any failure. Run before committing allowlist changes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

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
if (!key) throw new Error('YOUTUBE_API_KEY required (.env.local)')

const { sources } = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'play', 'archival-sources.json'), 'utf8'),
)
const { links } = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'play', 'archival-links.json'), 'utf8'),
)

const allowed = new Set(sources.map((source) => source.channelId))
const entries = Object.entries(links)
if (entries.length === 0) {
  console.log('no archival links to validate')
  process.exit(0)
}

const ids = entries.map(([, link]) => link.videoId).join(',')
const res = await fetch(
  `https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${ids}&key=${key}`,
)
if (!res.ok) throw new Error(`videos.list HTTP ${res.status}`)
const body = await res.json()
const byId = new Map(body.items.map((item) => [item.id, item]))

let failures = 0
for (const [playKey, link] of entries) {
  const item = byId.get(link.videoId)
  const problems = []
  if (!item) problems.push('video not found (removed?)')
  else {
    if (item.status.privacyStatus !== 'public') problems.push('not public')
    if (!item.status.embeddable) problems.push('not embeddable')
    if (item.snippet.channelId !== link.sourceChannelId)
      problems.push(
        `channel mismatch: on ${item.snippet.channelId}, mapping claims ${link.sourceChannelId}`,
      )
    if (!allowed.has(link.sourceChannelId))
      problems.push('claimed channel is not on the allowlist')
  }
  if (problems.length > 0) {
    failures += 1
    console.log(`FAIL ${playKey} (${link.videoId}): ${problems.join('; ')}`)
  } else {
    console.log(
      `OK   ${playKey} -> ${link.videoId} on ${item.snippet.channelTitle} — "${item.snippet.title.slice(0, 70)}"`,
    )
  }
}

console.log(`${entries.length} mappings, ${failures} failures`)
process.exit(failures > 0 ? 1 : 0)
