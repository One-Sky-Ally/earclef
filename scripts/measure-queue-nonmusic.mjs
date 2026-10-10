/**
 * MEASURE ONLY (owner brief Oct 10, 2026, part 3): how often are REAL
 * queue tracks news reports, interviews or promos instead of music?
 * Reported case: Uruguay 1996 — El Cuarteto de Nos "Info News",
 * Santiago Tavella "Bien clarito. El nuevo álbum de…".
 *
 * "Real" = exactly what a visitor's queue receives: the production
 * queue route (earclef.com/api/queue/artist/…) for the first N pool
 * artists of each sampled place+year, in panel order. Nothing here
 * changes code or data. A cache MISS on production does resolve the
 * artist live (as a visitor's queue would) and spends YouTube quota,
 * so the run is capped: it stops on any quota answer, and after
 * MAX_LIVE_RESOLVES slow answers (> SLOW_MS, i.e. probably resolved
 * live rather than read from cache).
 *
 * Each collected video then gets ONE batched videos.list (snippet +
 * contentDetails + topicDetails, 1 unit per 50 ids) so title,
 * description first line, channel and topics can be read. Flags are a
 * TRIAGE NET for hand review, not verdicts.
 *
 * Resumable: state in data/queue-nonmusic-audit.json, saved after each
 * artist; a rerun continues where it stopped (--fresh restarts).
 *
 * Usage: node --env-file=.env.local scripts/measure-queue-nonmusic.mjs [--fresh]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const SITE = 'https://earclef.com'
const OUT_PATH = 'data/queue-nonmusic-audit.json'
const ARTISTS_PER_COMBO = 12
const DELAY_MS = 1500
const SLOW_MS = 4000
const MAX_LIVE_RESOLVES = 20
const FRESH = process.argv.includes('--fresh')

/** Spread across regions and eras; UY 1996 is the reported case. */
const COMBOS = [
  ['UY', 1996], ['AR', 1985], ['MX', 2005], ['CL', 2000], ['CO', 2010],
  ['BR', 1990], ['ES', 2010], ['FR', 2000], ['IT', 1980], ['DE', 1995],
  ['JP', 2000], ['KR', 2015], ['IN', 2005], ['NG', 1985], ['EG', 2015],
  ['TR', 1995], ['US', 2010], ['GB', 1985], ['SE', 2005], ['PE', 1975],
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalize = (value) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Triage vocabulary — news, TV, interview, promo and announcement words
 * in the languages of the sample. Whole words, title or first
 * description line. Most hits will be music; that is what review is for.
 */
const NEWS_WORDS =
  /\b(news|noticias?|noticiero|informativo|telediario|nachrichten|journal|actualit[eé]s?|notizie|tg\d?|jornal|entrevista|interview|intervista|entretien|reportaje|reportage|reportagem|programa|show de tv|tv|televisi[oó]n|canal|channel \d+|nuevo [aá]lbum|novo [aá]lbum|nuevo disco|new album|nouvel album|nuovo album|presenta(?:ci[oó]n)?|lanzamiento|lan[cç]amento|anuncio|announces?|estreno|premiere|en conversaci[oó]n|charla|habla|talks?|conferencia de prensa|press conference|info)\b/i

function flagsFor(track, facts, artistName) {
  const flags = []
  if (track.eraTitle && normalize(track.eraTitle) === normalize(artistName)) flags.push('eponymous-title')
  if (NEWS_WORDS.test(track.title)) flags.push('title-word')
  const firstLine = (facts?.description ?? '').split('\n')[0]
  if (firstLine && NEWS_WORDS.test(firstLine)) flags.push('description-word')
  if ((facts?.topics ?? []).some((url) => /Television_program|Society|Politics/.test(url))) flags.push('topic')
  if (facts?.categoryId && facts.categoryId !== '10') flags.push(`category-${facts.categoryId}`)
  return flags
}

function load() {
  if (FRESH || !existsSync(OUT_PATH)) return { combos: {}, liveResolves: 0, stopped: null }
  return JSON.parse(readFileSync(OUT_PATH, 'utf8'))
}

const save = (state) => writeFileSync(OUT_PATH, JSON.stringify(state, null, 1))

async function getJson(url, timeoutMs = 60_000) {
  const started = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const body = await res.json().catch(() => null)
  return { status: res.status, body, ms: Date.now() - started }
}

async function collect(state) {
  for (const [country, year] of COMBOS) {
    const id = `${country}-${year}`
    const combo = (state.combos[id] ??= { country, year, artists: [] })
    if (combo.done) continue
    if (!combo.pool) {
      const { status, body } = await getJson(`${SITE}/api/explore/${country}/${year}`)
      if (status !== 200 || !body) {
        combo.error = `explore HTTP ${status}`
        combo.done = true
        save(state)
        continue
      }
      combo.pool = (body.panelArtists ?? []).slice(0, ARTISTS_PER_COMBO).map(({ id: mbid, name }) => ({ mbid, name }))
      save(state)
    }
    const decade = Math.floor(year / 10) * 10
    for (const artist of combo.pool) {
      if (combo.artists.some((done) => done.mbid === artist.mbid)) continue
      const url = `${SITE}/api/queue/artist/${artist.mbid}/${decade}?name=${encodeURIComponent(artist.name)}`
      let result
      try {
        result = await getJson(url)
      } catch (error) {
        result = { status: 0, body: null, ms: 0, error: String(error) }
      }
      if (result.status === 503 && result.body?.quota) {
        state.stopped = `quota answer at ${id} ${artist.name}`
        save(state)
        return
      }
      if (result.ms > SLOW_MS) state.liveResolves++
      combo.artists.push({
        ...artist,
        status: result.status,
        ms: result.ms,
        tracks: (result.body?.tracks ?? []).map((track) => ({
          videoId: track.videoId,
          title: track.title,
          source: track.source,
          era: track.era,
          eraTitle: track.eraTitle ?? null,
        })),
      })
      save(state)
      if (state.liveResolves >= MAX_LIVE_RESOLVES) {
        state.stopped = `live-resolve cap (${MAX_LIVE_RESOLVES}) at ${id} ${artist.name}`
        save(state)
        return
      }
      await sleep(DELAY_MS)
    }
    combo.done = true
    save(state)
  }
}

async function enrich(state) {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY missing — run with --env-file=.env.local')
  state.facts ??= {}
  const ids = [...new Set(
    Object.values(state.combos).flatMap((combo) =>
      combo.artists.flatMap((artist) => artist.tracks.map((track) => track.videoId))),
  )].filter((id) => !state.facts[id])
  for (let at = 0; at < ids.length; at += 50) {
    const batch = ids.slice(at, at + 50)
    const { status, body } = await getJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,topicDetails&id=${batch.join(',')}&key=${key}`,
    )
    if (status !== 200) throw new Error(`videos.list HTTP ${status}`)
    for (const item of body.items ?? []) {
      state.facts[item.id] = {
        channel: item.snippet?.channelTitle ?? null,
        categoryId: item.snippet?.categoryId ?? null,
        // By code point: a UTF-16 slice can split an emoji into a lone surrogate.
        description: Array.from(item.snippet?.description ?? '').slice(0, 400).join(''),
        duration: item.contentDetails?.duration ?? null,
        topics: item.topicDetails?.topicCategories ?? [],
      }
    }
    for (const id of batch) state.facts[id] ??= { missing: true }
    save(state)
  }
}

function summarize(state) {
  let artists = 0
  let withTracks = 0
  let tracks = 0
  let firstTracks = 0
  const flagged = []
  for (const combo of Object.values(state.combos)) {
    for (const artist of combo.artists) {
      artists++
      if (artist.tracks.length > 0) withTracks++
      artist.tracks.forEach((track, index) => {
        tracks++
        if (index === 0) firstTracks++
        const flags = flagsFor(track, state.facts?.[track.videoId], artist.name)
        if (flags.length > 0) {
          flagged.push({
            combo: `${combo.country} ${combo.year}`,
            artist: artist.name,
            position: index,
            videoId: track.videoId,
            title: track.title,
            eraTitle: track.eraTitle,
            flags,
            channel: state.facts?.[track.videoId]?.channel ?? null,
            duration: state.facts?.[track.videoId]?.duration ?? null,
            descriptionFirstLine: (state.facts?.[track.videoId]?.description ?? '').split('\n')[0],
          })
        }
      })
    }
  }
  state.summary = { artists, withTracks, tracks, firstTracks, flagged: flagged.length }
  state.flagged = flagged
  save(state)
  console.log(JSON.stringify(state.summary))
}

async function main() {
  const state = load()
  state.startedAt ??= new Date().toISOString()
  if (!state.stopped) await collect(state)
  await enrich(state)
  summarize(state)
  if (state.stopped) console.log(`stopped early: ${state.stopped}`)
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
