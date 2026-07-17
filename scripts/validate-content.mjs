/**
 * Validate every content/*.json against the Ear Clef artist schema.
 *   node scripts/validate-content.mjs           # structural checks only
 *   node scripts/validate-content.mjs --remote  # + verify IDs against
 *     MusicBrainz / iTunes / YouTube oEmbed (slow, rate-limit friendly)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONTENT_DIR = 'content'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const YT_CHANNEL = /^UC[\w-]{22}$/
const YT_VIDEO = /^[\w-]{11}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PLATFORMS = new Set([
  'appleMusic', 'bandcamp', 'website', 'instagram', 'x', 'facebook',
  'youtube', 'tiktok', 'dragcity', 'soundcloud',
])
const UA = 'EarClefValidator/0.1 (https://earclef.netlify.app)'

const remote = process.argv.includes('--remote')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

function problem(slug, message) {
  failures++
  console.log(`  ✗ ${slug}: ${message}`)
}

function checkStructure(slug, c) {
  const issues = []
  if (c.slug !== slug) issues.push(`slug "${c.slug}" ≠ filename`)
  for (const key of ['schemaVersion', 'meta', 'integrations', 'hero', 'listen', 'watch', 'story', 'shows', 'merch', 'press', 'footer']) {
    if (!(key in c)) issues.push(`missing ${key}`)
  }
  if (issues.length) return issues

  const expectedCanonical = `https://earclef.netlify.app/${slug}`
  if (c.meta.canonicalUrl !== expectedCanonical) {
    issues.push(`canonicalUrl ${c.meta.canonicalUrl}`)
  }
  if (c.hero.tagline !== 'Hear here!') issues.push('hero.tagline drift')
  const TIERS = ['heavy-rotation', 'in-the-mix', 'on-the-radar']
  if ('tier' in c && !TIERS.includes(c.tier)) {
    issues.push(`bad tier "${c.tier}" (expected one of ${TIERS.join(', ')})`)
  }

  // Native audio: the one exception to "we never host audio" — a rights
  // statement is mandatory whenever it's enabled.
  if ('play' in c) {
    const p = c.play
    if (p.enabled && !(typeof p.rights === 'string' && p.rights.length >= 20)) {
      issues.push('play.enabled requires a substantive play.rights statement')
    }
    if (!Array.isArray(p.tracks)) {
      issues.push('play.tracks must be an array')
    } else {
      for (const t of p.tracks) {
        if (!t.title || typeof t.title !== 'string') issues.push('play track missing title')
        if (!/^[a-z0-9._-]+\.(m4a|mp3)$/i.test(t.file ?? '')) {
          issues.push(`bad play track file "${t.file}"`)
        }
        if (typeof t.duration !== 'number' || t.duration <= 0) {
          issues.push(`play track "${t.title}" needs a positive duration in seconds`)
        }
      }
    }
  }

  // Membership: price and honest public copy are mandatory when enabled;
  // a connected-account id must look like a Stripe acct id.
  if ('membership' in c) {
    const m = c.membership
    if (m.enabled) {
      if (!(typeof m.priceUsd === 'number' && m.priceUsd > 0)) {
        issues.push('membership.enabled requires a positive priceUsd')
      }
      if (!(typeof m.perkTitle === 'string' && m.perkTitle.length >= 3)) {
        issues.push('membership.enabled requires a perkTitle')
      }
      if (!(typeof m.teaser === 'string' && m.teaser.length >= 20)) {
        issues.push('membership.enabled requires substantive teaser copy')
      }
    }
    if (m.stripeAccountId && !/^acct_[A-Za-z0-9]+$/.test(m.stripeAccountId)) {
      issues.push(`bad stripeAccountId "${m.stripeAccountId}"`)
    }
  }

  const { youtube, setlistfm, itunes } = c.integrations
  if (youtube.channelId && !YT_CHANNEL.test(youtube.channelId)) {
    issues.push(`bad channelId ${youtube.channelId}`)
  }
  if (setlistfm.mbid && !UUID.test(setlistfm.mbid)) {
    issues.push(`bad mbid ${setlistfm.mbid}`)
  }
  if (itunes?.artistId && !/^\d{1,12}$/.test(itunes.artistId)) {
    issues.push(`bad itunes id ${itunes.artistId}`)
  }

  for (const p of [...c.listen.platforms, ...c.hero.socials]) {
    if (p.platform === 'spotify') issues.push(`spotify link present: ${p.url}`)
    if (!PLATFORMS.has(p.platform)) issues.push(`unknown platform ${p.platform}`)
    if (!/^https:\/\//.test(p.url)) issues.push(`non-https url ${p.url}`)
  }
  for (const album of c.listen.featuredAlbums ?? []) {
    if (!album.title) issues.push('featured album missing title')
    if (album.mbReleaseGroupId && !UUID.test(album.mbReleaseGroupId)) {
      issues.push(`bad rgid on "${album.title}"`)
    }
  }
  if (c.listen.enabled && !('featuredAlbums' in c.listen)) {
    issues.push('listen.featuredAlbums missing')
  }
  // Service absences are owner-asserted claims — keep them well-formed.
  const ABSENT_PLATFORMS = new Set(['spotify', 'appleMusic', 'amazonMusic'])
  for (const absence of c.listen.notOn ?? []) {
    if (!ABSENT_PLATFORMS.has(absence.platform)) {
      issues.push(`bad notOn platform "${absence.platform}"`)
    }
    if (absence.note !== undefined && (typeof absence.note !== 'string' || absence.note.length > 160)) {
      issues.push('notOn note must be a string ≤160 chars')
    }
  }
  for (const video of c.watch.videos) {
    if (!YT_VIDEO.test(video.youtubeId)) issues.push(`bad videoId ${video.youtubeId}`)
  }
  if (c.watch.enabled && c.watch.videos.length === 0) {
    issues.push('watch enabled but empty')
  }
  for (const show of [...c.shows.upcoming, ...c.shows.past]) {
    if (!ISO_DATE.test(show.date)) issues.push(`bad show date ${show.date}`)
    if (show.setlistUrl && !show.setlistUrl.startsWith('https://www.setlist.fm/')) {
      issues.push(`bad setlistUrl ${show.setlistUrl}`)
    }
  }
  const editMes = JSON.stringify(c).match(/EDIT-ME/g)?.length ?? 0
  if (editMes > 0) console.log(`  ⚠ ${slug}: ${editMes} EDIT-ME markers (intentional?)`)
  return issues
}

async function safeFetch(url, options) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url, options)
    } catch (error) {
      if (attempt === 3) return { ok: false, status: `network: ${error.code ?? error.message}` }
      await sleep(2000 * attempt)
    }
  }
}

async function checkRemote(slug, c) {
  const { setlistfm, itunes, youtube } = c.integrations
  if (setlistfm.mbid) {
    const res = await safeFetch(
      `https://musicbrainz.org/ws/2/artist/${setlistfm.mbid}?fmt=json`,
      { headers: { 'User-Agent': UA } },
    )
    if (res.ok) {
      const body = await res.json()
      console.log(`  MB: ${body.name}`)
    } else {
      problem(slug, `MBID lookup HTTP ${res.status}`)
    }
    await sleep(1500)
  }
  if (itunes?.artistId) {
    const res = await safeFetch(
      `https://itunes.apple.com/lookup?id=${itunes.artistId}`,
      { headers: { 'User-Agent': UA } },
    )
    if (res.ok) {
      const body = await res.json()
      console.log(`  iTunes: ${body.results?.[0]?.artistName ?? 'NOT FOUND'}`)
    }
    await sleep(3500)
  }
  const firstVideo = c.watch.videos[0]
  if (firstVideo) {
    const res = await safeFetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${firstVideo.youtubeId}&format=json`,
    )
    if (res.ok) {
      const body = await res.json()
      console.log(`  YT: "${body.title}" by ${body.author_name}`)
    } else {
      problem(slug, `video ${firstVideo.youtubeId} oEmbed HTTP ${res.status}`)
    }
    await sleep(800)
  }
  if (youtube.channelId && c.watch.enabled && !firstVideo) {
    problem(slug, 'channelId set but no videos')
  }
}

const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort()
console.log(`${files.length} content files`)
for (const file of files) {
  const slug = file.slice(0, -5)
  let content
  try {
    content = JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'))
  } catch (error) {
    problem(slug, `JSON parse error: ${error.message}`)
    continue
  }
  const issues = checkStructure(slug, content)
  if (issues.length === 0) {
    console.log(`✓ ${slug}`)
  } else {
    for (const issue of issues) problem(slug, issue)
  }
  if (remote) await checkRemote(slug, content)
}

console.log(failures === 0 ? '\nALL VALID' : `\n${failures} PROBLEMS`)
process.exit(failures === 0 ? 0 : 1)
