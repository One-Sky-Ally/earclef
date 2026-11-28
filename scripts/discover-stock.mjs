#!/usr/bin/env node
/**
 * Discover stock — Phase E of /refresh-earclef. Keeps Discover stocked
 * with verified picks and NO model call on the site (owner ruling,
 * Oct 15 2026): the candidates are written in the refresh session, this
 * script verifies them locally and uploads full sets.
 *
 *   npm run discover-stock -- plan      what to add; writes the two briefs
 *   (write data/discover-stock/candidates.json in-session)
 *   npm run discover-stock -- verify    checks candidates (resumable; --minutes 90)
 *   npm run discover-stock -- upload    sends full sets to earclef.com
 *   npm run discover-stock -- recheck   drops stocked songs whose video died and
 *                                       refreshes what YouTube says about the
 *                                       rest (the 30-day rule)
 *   npm run discover-stock -- enrich    "more from this artist" + "Listen on"
 *                                       links for stocked picks (resumable;
 *                                       --minutes 90; --upload-only)
 *   npm run discover-stock -- status    what is ready on the site
 *   npm run discover-stock -- why "toe" ["Hear You"]
 *                                       one artist, step by step: why a
 *                                       song was or wasn't found
 *
 * Only picks with a verified PLAYABLE song are stocked (owner ruling,
 * Oct 15 2026 — the Songs-about rule); the rest are skipped and logged.
 *
 * Lists: SHARED — daily sets of 12 for everyone; OWNER — the owner's own
 * sets of 8, from the rows in their linked account. Each refresh adds up
 * to two weeks of sets per list, growing toward 60 shared days / 30
 * owner sets (lib/discover/stock.ts).
 *
 * Needs OWNER_KEY, DISCOGS_TOKEN and YOUTUBE_API_KEY in .env.local.
 * EARCLEF_URL overrides https://earclef.com (e.g. a local dev server).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'data', 'discover-stock')
const PLAN = join(DIR, 'plan.json')
const CANDIDATES = join(DIR, 'candidates.json')
const PROGRESS = join(DIR, 'verified.json')
/**
 * Enrich progress (gitignored). An entry is read again after 21 days and
 * deleted from disk then: with the weekly recheck refreshing what the
 * site keeps, nothing from the YouTube API ever ages past 30 days.
 */
const ENRICHED = join(DIR, 'enriched.json')
const ENRICH_FRESH_DAYS = 21
const ENRICH_BATCH = 100
const KINDS = ['shared', 'owner']
/** Candidates written per needed pick: some fail verification or have no playable song. */
const CANDIDATE_MARGIN = 1.5
/**
 * Discogs records read per artist in this LOCAL run (the site's old
 * nightly job read 10 inside a 15-minute function; here there is no
 * such limit, and reading stops early once enough songs verify).
 */
const MAX_RECORDS = 25
const DEFAULT_MINUTES = 90

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

function log(line) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)
}

const readJson = (path, fallback) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const BASE = (env('EARCLEF_URL') ?? 'https://earclef.com').replace(/\/$/, '')

async function site(method, body, query = '') {
  const key = env('OWNER_KEY')
  if (!key) throw new Error('OWNER_KEY missing from .env.local')
  const res = await fetch(`${BASE}/api/studio/discover-stock${query}`, {
    method,
    headers: { 'x-owner-key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} discover-stock → HTTP ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

const roster = () => readJson(join(ROOT, 'lib', 'discover', 'roster.json'), [])

function emptyProgress() {
  return {
    shared: { picks: [], tried: [] },
    owner: { picks: [], tried: [] },
  }
}

async function plan() {
  const { buildStockPrompt } = await import('../lib/discover/prompt.ts')
  mkdirSync(DIR, { recursive: true })
  const status = await site('GET')
  const progress = readJson(PROGRESS, emptyProgress())
  const artists = roster().map(({ slug, name, identity }) => ({ slug, name, identity }))
  // Picks verified on an earlier run but not uploaded yet still count.
  const carried = KINDS.flatMap((kind) => progress[kind].picks.map((pick) => pick.name))
  const avoid = [...new Set([...status.stocked.names, ...carried])]
  const out = { createdAt: new Date().toISOString(), base: BASE, stockedMbids: status.stocked.mbids }
  for (const kind of KINDS) {
    const setSize = status.setSizes[kind]
    const needed = Math.max(0, status[kind].add * setSize - progress[kind].picks.length)
    const count = Math.ceil(needed * CANDIDATE_MARGIN)
    const library =
      kind === 'shared' ? { kind: 'roster', artists } : status.ownerLibrary
    const brief = count > 0 ? buildStockPrompt({ library, count, setSize, avoid }) : ''
    out[kind] = { addSets: status[kind].add, setSize, needed, count, ready: status[kind].ready }
    if (brief) writeFileSync(join(DIR, `brief-${kind}.txt`), `${brief}\n`)
  }
  writeJson(PLAN, out)
  log(`site: shared ${status.shared.ready} days ready (through ${status.shared.through ?? '—'}), owner ${status.owner.ready} sets ready`)
  log(`owner sets follow: ${status.ownerLibrarySource === 'account' ? 'the linked account’s rows' : 'the original site tiers (no linked account yet)'}`)
  for (const kind of KINDS) {
    const entry = out[kind]
    log(
      entry.count > 0
        ? `${kind}: add ${entry.addSets} sets of ${entry.setSize} → write ${entry.count} candidates (brief: data/discover-stock/brief-${kind}.txt)`
        : `${kind}: nothing to add this refresh`,
    )
  }
  if (out.shared.count + out.owner.count > 0) {
    log('next: write data/discover-stock/candidates.json as {"shared": [...], "owner": [...]}, then `verify`')
  }
}

function loadCandidates() {
  const raw = readJson(CANDIDATES, null)
  if (!raw) throw new Error('data/discover-stock/candidates.json not found — write it from the briefs first')
  const out = {}
  for (const kind of KINDS) {
    const list = Array.isArray(raw[kind]) ? raw[kind] : []
    out[kind] = list.filter(
      (entry) =>
        entry &&
        typeof entry.name === 'string' &&
        entry.name.trim() &&
        typeof entry.knownFor === 'string' &&
        typeof entry.why === 'string',
    )
  }
  return out
}

async function verify(minutes) {
  const { normalize, verifyCandidate } = await import('../lib/discover/verify.ts')
  const token = env('DISCOGS_TOKEN')
  const youtube = env('YOUTUBE_API_KEY')
  if (!youtube) throw new Error('YOUTUBE_API_KEY missing from .env.local (songs need it)')
  if (token) process.env.DISCOGS_TOKEN = token
  else log('no DISCOGS_TOKEN — song checks run at the slower public rate')
  process.env.YOUTUBE_API_KEY = youtube

  const planned = readJson(PLAN, null)
  if (!planned) throw new Error('run `plan` first')
  const candidates = loadCandidates()
  const progress = readJson(PROGRESS, emptyProgress())
  const list = roster()
  const rosterKeys = new Set(list.flatMap((artist) => [normalize(artist.name), normalize(artist.slug)]))
  const rosterSlugs = new Set(list.map((artist) => artist.slug))
  const rosterMbids = new Set(list.flatMap((artist) => (artist.mbid ? [artist.mbid] : [])))
  const seenMbids = new Set([
    ...planned.stockedMbids,
    ...KINDS.flatMap((kind) => progress[kind].picks.map((pick) => pick.mbid)),
  ])
  const triedKeys = new Set(KINDS.flatMap((kind) => progress[kind].tried))

  const deadline = Date.now() + minutes * 60_000
  const target = (kind) => planned[kind].addSets * planned[kind].setSize
  const queues = Object.fromEntries(
    KINDS.map((kind) => [kind, candidates[kind].filter((c) => !triedKeys.has(normalize(c.name)))]),
  )
  const wants = (kind) => progress[kind].picks.length < target(kind) && queues[kind].length > 0
  const started = Date.now()
  let checked = 0

  while (Date.now() < deadline && KINDS.some(wants)) {
    for (const kind of KINDS) {
      if (!wants(kind) || Date.now() >= deadline) continue
      const candidate = queues[kind].shift()
      const key = normalize(candidate.name)
      if (triedKeys.has(key)) continue // a name listed twice
      triedKeys.add(key)
      progress[kind].tried.push(key)
      checked++
      const { pick, reason } = await verifyCandidate(candidate, {
        rosterKeys,
        rosterSlugs,
        rosterMbids,
        songDeadline: deadline,
        maxRecords: MAX_RECORDS,
      })
      if (reason === 'musicbrainz unavailable' || reason === 'song lookup unavailable') {
        // MusicBrainz, Discogs or YouTube never answered: not a verdict on
        // the artist, so the next `verify` run tries this candidate again.
        progress[kind].tried = progress[kind].tried.filter((tried) => tried !== key)
      }
      const kept = pick && !seenMbids.has(pick.mbid)
      if (kept) {
        seenMbids.add(pick.mbid)
        progress[kind].picks.push(pick)
      }
      writeJson(PROGRESS, progress)
      log(
        `[${kind} ${progress[kind].picks.length}/${target(kind)}] ${kept ? '✓' : '✗'} ${candidate.name}${
          kept ? ` · ${pick.song.kind}` : pick ? ' (already stocked)' : ` (${reason})`
        }`,
      )
    }
  }

  const elapsed = Math.round((Date.now() - started) / 60_000)
  for (const kind of KINDS) {
    const songs = progress[kind].picks.filter((pick) => pick.song).length
    log(`${kind}: ${progress[kind].picks.length}/${target(kind)} verified (${songs} with a song)`)
  }
  log(`${checked} checked in ${elapsed} min`)
  if (KINDS.some(wants)) log('out of time — run `verify` again to continue, or `upload` what is done')
  else if (KINDS.some((kind) => progress[kind].picks.length < target(kind))) {
    log('candidates ran out before the target — write more into candidates.json and `verify` again, or `upload` what is done')
  } else log('next: `upload`')
}

async function upload() {
  const progress = readJson(PROGRESS, emptyProgress())
  const planned = readJson(PLAN, {})
  const sizes = {
    shared: planned.shared?.setSize ?? 12,
    owner: planned.owner?.setSize ?? 8,
  }
  for (const kind of KINDS) {
    const pending = progress[kind].picks
    const full = Math.floor(pending.length / sizes[kind])
    if (full === 0) {
      log(`${kind}: ${pending.length} verified — not a full set of ${sizes[kind]} yet, kept for next time`)
      continue
    }
    const sets = Array.from({ length: full }, (_, i) =>
      pending.slice(i * sizes[kind], (i + 1) * sizes[kind]),
    )
    const keep = pending.slice(full * sizes[kind])
    let added = 0
    let ready = null
    for (let i = 0; i < sets.length; i += 10) {
      const batch = sets.slice(i, i + 10)
      const result = await site('POST', { action: 'append', kind, sets: batch })
      added += result.added
      ready = result.ready
      // A rejected set (a pick stocked meanwhile) goes back for next time.
      for (const position of result.rejected ?? []) keep.push(...batch[position])
    }
    progress[kind].picks = keep
    writeJson(PROGRESS, progress)
    log(`${kind}: uploaded ${added} sets — ${ready} ready on the site; ${keep.length} picks kept for next time`)
  }
}

const decodeEntities = (value) =>
  value.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function recheck() {
  readEnriched() // old enrich entries leave the disk on every weekly run too
  const youtube = env('YOUTUBE_API_KEY')
  if (!youtube) throw new Error('YOUTUBE_API_KEY missing from .env.local')
  const status = await site('GET')
  const ids = status.videos
  const alive = new Set()
  // What YouTube says today about every video still playing: the stored
  // upload title and channel are refreshed, so nothing kept from the
  // YouTube API is older than 30 days (the privacy page's promise).
  const facts = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const url = `https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${chunk.join(',')}&key=${youtube}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`YouTube videos.list → HTTP ${res.status}`)
    const body = await res.json()
    for (const item of body.items ?? []) {
      const s = item.status ?? {}
      if (s.privacyStatus === 'public' && s.embeddable !== false && s.uploadStatus === 'processed') {
        alive.add(item.id)
        facts.push({
          videoId: item.id,
          uploadTitle: decodeEntities(item.snippet?.title ?? ''),
          uploader: decodeEntities(item.snippet?.channelTitle ?? ''),
        })
      }
    }
  }
  const dead = ids.filter((id) => !alive.has(id))
  if (dead.length === 0) log(`all ${ids.length} stocked videos still play (${Math.ceil(ids.length / 50)} units)`)
  else {
    const result = await site('POST', { action: 'drop-songs', videoIds: dead })
    log(
      `${dead.length} of ${ids.length} videos gone — ${result.songsDropped} pick songs dropped (their picks stay, with their links), ${result.moreDropped ?? 0} taken out of "more from this artist"`,
    )
  }
  let refreshed = 0
  for (let i = 0; i < facts.length; i += 2000) {
    const result = await site('POST', { action: 'refresh-songs', songs: facts.slice(i, i + 2000) })
    refreshed += result.refreshed
  }
  log(`refreshed what YouTube says about ${facts.length} videos (${refreshed} stored songs updated)`)
}

/** The enrich file with old entries gone — from disk too, at once. */
function readEnriched() {
  const state = readJson(ENRICHED, { done: {}, uploaded: [] })
  const cutoff = Date.now() - ENRICH_FRESH_DAYS * 86_400_000
  const before = Object.keys(state.done).length
  for (const [mbid, entry] of Object.entries(state.done)) {
    if (!(Date.parse(entry.at) >= cutoff)) delete state.done[mbid]
  }
  state.uploaded = state.uploaded.filter((mbid) => state.done[mbid])
  if (existsSync(ENRICHED) && Object.keys(state.done).length !== before) writeJson(ENRICHED, state)
  return state
}

/**
 * Once uploaded, an entry keeps only what a later run needs: when it was
 * read, and — for a stocked song that no longer passes — the old and the
 * proposed song for the hand-check. The songs themselves live on the site.
 */
function slimUploaded(entry) {
  return entry.ownStillVerified
    ? { name: entry.name, at: entry.at, ownStillVerified: true }
    : { name: entry.name, at: entry.at, ownStillVerified: false, own: entry.own, best: entry.best }
}

/** MusicBrainz id → position on All past picks (owner's view, newest first). */
async function pastMbids() {
  const res = await fetch(`${BASE}/api/discover/past?own=1`, { headers: { 'x-owner-key': env('OWNER_KEY') ?? '' } })
  if (!res.ok) return new Map()
  const body = await res.json()
  return new Map((body.artists ?? []).map((artist, i) => [artist.pick.mbid, i]))
}

/**
 * "More from this artist" and the "Listen on" links for picks already
 * stocked (owner, Nov 28 2026): each artist read again by the stored
 * MusicBrainz id through the same song chain and bar as stocking. Picks
 * whose stored song no longer passes today's rules are listed for a
 * hand-check (and replaced with `replace-songs`, never automatically).
 */
async function enrich(minutes, uploadOnly) {
  const state = readEnriched()
  if (!uploadOnly) {
    const { enrichPick } = await import('../lib/discover/verify.ts')
    const token = env('DISCOGS_TOKEN')
    const youtube = env('YOUTUBE_API_KEY')
    if (!youtube) throw new Error('YOUTUBE_API_KEY missing from .env.local')
    if (token) process.env.DISCOGS_TOKEN = token
    process.env.YOUTUBE_API_KEY = youtube
    const deadline = Date.now() + minutes * 60_000
    const context = { songDeadline: deadline, maxRecords: MAX_RECORDS }

    // Picks verified but not uploaded yet (verified before this step existed).
    const progress = readJson(PROGRESS, emptyProgress())
    for (const kind of KINDS) {
      for (const pick of progress[kind].picks) {
        if (Array.isArray(pick.more) || Date.now() >= deadline) continue
        const result = await enrichPick(pick, context)
        if (result === 'unavailable') continue
        pick.more = result.more
        pick.services = result.services
        writeJson(PROGRESS, progress)
        log(`[waiting ${kind}] ${pick.name}: +${result.more.length} songs`)
      }
    }

    const status = await site('GET', undefined, '?songs=1')
    const seen = new Set()
    const todo = status.songs.filter((entry) => {
      if (!entry.song || entry.enriched || state.done[entry.mbid] || seen.has(entry.mbid)) return false
      seen.add(entry.mbid)
      return true
    })
    // Picks already shown (All past picks, newest first) before the ones still to come.
    const shown = await pastMbids()
    const rank = (mbid) => (shown.has(mbid) ? shown.get(mbid) : Number.MAX_SAFE_INTEGER)
    todo.sort((a, b) => rank(a.mbid) - rank(b.mbid))
    log(`${todo.length} stocked artists to read, ${todo.filter((entry) => shown.has(entry.mbid)).length} of them already shown (${Object.keys(state.done).length} read on earlier runs)`)
    let n = 0
    for (const entry of todo) {
      if (Date.now() >= deadline) break
      n++
      const result = await enrichPick(entry, context)
      if (result === 'unavailable') {
        log(`[${n}/${todo.length}] ${entry.name}: no answer from MusicBrainz, Discogs or YouTube — next run`)
        continue
      }
      state.done[entry.mbid] = {
        name: entry.name,
        own: entry.song,
        more: result.more,
        services: result.services,
        ownStillVerified: result.ownStillVerified,
        best: result.best,
        at: new Date().toISOString(),
      }
      writeJson(ENRICHED, state)
      log(
        `[${n}/${todo.length}] ${entry.name}: +${result.more.length} songs, ${Object.keys(result.services).length} services` +
          (result.ownStillVerified ? '' : ' — its stocked song no longer passes; listed for a hand-check'),
      )
    }
    if (todo.some((entry) => !state.done[entry.mbid])) log('not every artist was read — run `enrich` again to continue')
  }

  const pending = Object.entries(state.done).filter(([mbid]) => !state.uploaded.includes(mbid))
  for (let i = 0; i < pending.length; i += ENRICH_BATCH) {
    const batch = pending.slice(i, i + ENRICH_BATCH)
    const result = await site('POST', {
      action: 'enrich',
      entries: batch.map(([mbid, entry]) => ({ mbid, more: entry.more, services: entry.services })),
    })
    state.uploaded.push(...batch.map(([mbid]) => mbid))
    for (const [mbid] of batch) state.done[mbid] = slimUploaded(state.done[mbid])
    writeJson(ENRICHED, state)
    log(`uploaded ${batch.length} artists (${result.enriched} stocked picks enriched)`)
  }
  const stale = Object.entries(state.done).filter(([, entry]) => !entry.ownStillVerified)
  if (stale.length > 0) {
    log(`${stale.length} stocked songs no longer pass today's rules — hand-check, then replace-songs:`)
    for (const [mbid, entry] of stale) {
      log(`  ${entry.name} (${mbid}): "${entry.own?.uploadTitle}" by ${entry.own?.uploader} → ${entry.best ? `"${entry.best.uploadTitle}" by ${entry.best.uploader} (${entry.best.videoId})` : 'no verified song now'}`)
    }
  }
}

/** One artist, step by step — why a song was or wasn't found. */
async function why(name, knownFor) {
  if (!name) throw new Error('usage: npm run discover-stock -- why "<artist>" ["<known for title>"]')
  const { normalize, verifyCandidate } = await import('../lib/discover/verify.ts')
  const token = env('DISCOGS_TOKEN')
  const youtube = env('YOUTUBE_API_KEY')
  if (!youtube) throw new Error('YOUTUBE_API_KEY missing from .env.local')
  if (token) process.env.DISCOGS_TOKEN = token
  process.env.YOUTUBE_API_KEY = youtube
  const list = roster()
  const { pick, reason } = await verifyCandidate(
    { name, why: '', knownFor: knownFor ?? '', connectsTo: [] },
    {
      rosterKeys: new Set(list.flatMap((artist) => [normalize(artist.name), normalize(artist.slug)])),
      rosterSlugs: new Set(list.map((artist) => artist.slug)),
      rosterMbids: new Set(list.flatMap((artist) => (artist.mbid ? [artist.mbid] : []))),
      songDeadline: Date.now() + 10 * 60_000,
      maxRecords: MAX_RECORDS,
      trace: (line) => log(line),
    },
  )
  log(pick ? `→ would be stocked with "${pick.song.title}" (${pick.song.kind}, ${pick.song.videoId})` : `→ skipped: ${reason}`)
}

async function status() {
  const s = await site('GET')
  log(`shared: ${s.shared.ready} days ready (through ${s.shared.through ?? '—'})${s.shared.todayArchive ? ' — today is from the archive' : ''}; next refresh adds ${s.shared.add}`)
  log(`owner: ${s.owner.ready} sets ready, ${s.owner.seen} seen; next refresh adds ${s.owner.add}`)
  log(`stocked artists: ${s.stocked.names.length}, songs: ${s.videos.length}`)
}

const [command, ...rest] = process.argv.slice(2)
const minutesFlag = rest.indexOf('--minutes')
const minutes = minutesFlag >= 0 ? Number(rest[minutesFlag + 1]) || DEFAULT_MINUTES : DEFAULT_MINUTES
const commands = {
  plan,
  verify: () => verify(minutes),
  upload,
  recheck,
  enrich: () => enrich(minutes, rest.includes('--upload-only')),
  status,
  why: () => why(rest[0], rest[1]),
}
if (!commands[command]) {
  console.error('usage: npm run discover-stock -- plan | verify [--minutes 90] | upload | recheck | enrich [--minutes 90] [--upload-only] | status | why "<artist>"')
  process.exit(1)
}
commands[command]().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
