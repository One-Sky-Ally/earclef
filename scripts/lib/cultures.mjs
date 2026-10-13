/**
 * "Music cultures" (UI handoff Phase 1, Oct 2026): the Explore page's
 * curated-journey panel and culture row, built ONLY from content the
 * site already ships and labelled as Ear Clef picks.
 *
 * Two kinds of collection:
 *   era   — a "What was playing" snapshot (lib/explore/playing.json):
 *           a documented place + era + sound, written in-session against
 *           cited sources. Its picks become the journey's tracks.
 *   songs — a "Songs about this place" list (songs-about-places.json):
 *           every song in it already carries a playability-checked video.
 *
 * A pick plays on the site only when the SAME SONG BY THE SAME ARTIST
 * already plays somewhere else on the site with a verified video:
 *   1. the #1-hits sweep (hits-play.json), keyed exactly by chart,
 *      credited artist and title — the picks in US/GB eras are chart #1s;
 *   2. "Songs about this place", plain records only (a cover, live take
 *      or remix is a different recording, so `ver` songs never join);
 *   3. "On this day", whose videos are id-anchored to the artist and the
 *      release, matched on the song the video is (`vs`).
 * Names compare under normalizeName with an explicit non-empty check —
 * missing is never a match (standing lesson 5). A pick with no verified
 * video stays in the list with no ▶; the page offers a labelled search.
 */
import { normalizeName } from './normalizeName.mjs'

/** Chart files the hits sweep keyed its videos under, per country. */
const CHART_BY_COUNTRY = { US: 'billboard-hot-100', GB: 'uk-singles-chart' }

/** "[[Toots Hibbert]] ruled…" → "Toots Hibbert ruled…". */
export function plainStory(story) {
  return (story ?? '').replace(/\[\[([^\]]+)\]\]/g, '$1').trim()
}

/** Song-title key: quotes and "(song)"-style decorations never count. */
function titleKey(title) {
  return normalizeName((title ?? '').replace(/^["“”']+|["“”']+$/g, ''))
}

/** artist|title key, or null when either side normalizes to nothing. */
export function songKey(artist, title) {
  const a = normalizeName(artist)
  const t = titleKey(title)
  return a && t ? `${a}|${t}` : null
}

/**
 * Index the three verified sources by song key. `otdItems` is a flat
 * list of On-this-day items (any shard); only items carrying a verified
 * video (`v`) are indexed.
 */
export function verifiedIndex({ hitsPlay, songPlaces, otdItems }) {
  const hits = new Map()
  for (const [key, play] of Object.entries(hitsPlay ?? {})) {
    const [chart, artist, title] = key.split('|')
    const song = songKey(artist, title)
    if (!song || !play?.videoId) continue
    hits.set(`${chart}|${song}`, { videoId: play.videoId, live: play.live === true })
  }
  const songs = new Map()
  for (const place of Object.values(songPlaces ?? {})) {
    for (const song of place.songs ?? []) {
      if (song.ver) continue
      const key = songKey(song.a, song.t)
      if (key && song.v && !songs.has(key)) songs.set(key, { videoId: song.v })
    }
  }
  const otd = new Map()
  for (const item of otdItems ?? []) {
    if (!item?.v) continue
    const key = songKey(item.n, item.vs ?? item.t)
    if (key && !otd.has(key)) otd.set(key, { videoId: item.v })
  }
  return { hits, songs, otd }
}

/** The verified video for one era pick, or null. */
export function verifiedVideoFor(index, country, artist, title) {
  const key = songKey(artist, title)
  if (!key) return null
  const chart = CHART_BY_COUNTRY[country]
  const hit = chart ? index.hits.get(`${chart}|${key}`) : undefined
  if (hit) return { ...hit, source: 'chart' }
  const song = index.songs.get(key)
  if (song) return { ...song, source: 'songs-about' }
  const otd = index.otd.get(key)
  if (otd) return { ...otd, source: 'on-this-day' }
  return null
}

const VIDEO_ID = /^[\w-]{11}$/

/** Era journeys from the "What was playing" entries. */
export function buildEraJourneys(entries, index, countryName) {
  return entries.map((entry) => {
    const tracks = entry.items.map((item) => {
      const video = verifiedVideoFor(index, entry.country, item.artist, item.work)
      const track = { artist: item.artist, title: item.work }
      if (item.note) track.note = item.note
      if (video && VIDEO_ID.test(video.videoId)) {
        track.videoId = video.videoId
        track.source = video.source
        if (video.live) track.live = true
      }
      return track
    })
    const playable = tracks.filter((track) => track.videoId)
    return {
      id: `${entry.country}-${entry.from}-${entry.to}`,
      kind: 'era',
      code: entry.country,
      place: countryName(entry.country),
      from: entry.from,
      to: entry.to,
      title: entry.era,
      basisKind: entry.kind,
      basis: entry.basis,
      summary: plainStory(entry.story),
      sources: entry.sources ?? [],
      tracks,
      playable: playable.length,
      thumb: playable[0]?.videoId ?? null,
    }
  })
}

/** One summary per "Songs about" place — the songs load on demand. */
export function buildSongPlaces(songPlaces) {
  return Object.entries(songPlaces ?? {})
    .map(([code, place]) => {
      const songs = (place.songs ?? []).filter((song) => VIDEO_ID.test(song.v ?? ''))
      if (songs.length === 0) return null
      const years = songs.map((song) => song.y).filter((year) => Number.isInteger(year))
      // An official video makes the best card picture; any verified one will do.
      const thumbSong = songs.find((song) => song.k === 'official-video' && !song.ver) ?? songs[0]
      return {
        id: `songs-${code}`,
        kind: 'songs',
        code,
        place: place.name,
        placeKind: place.kind,
        count: songs.length,
        firstYear: years.length ? Math.min(...years) : null,
        lastYear: years.length ? Math.max(...years) : null,
        thumb: thumbSong.v,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || a.place.localeCompare(b.place))
}
