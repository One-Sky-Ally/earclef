/**
 * "Music cultures" (UI handoff Phase 1, Oct 2026): the Explore page's
 * curated journeys and culture row, built ONLY from content the site
 * already ships and labelled as Ear Clef picks.
 *
 * OWNER RULE (Oct 14, 2026), the Songs-about rule applied to journeys:
 * a journey lists ONLY songs that actually play on the site — no search
 * links, nothing that teases music people can't listen to. A journey
 * without enough playable songs is not a journey and is left out (its
 * story stays in the globe's place panel).
 *
 * Three kinds of collection:
 *   era    — a "What was playing" snapshot (lib/explore/playing.json):
 *            a documented place + era + sound. Its picks that play come
 *            first; songs released in that place and span (verified, from
 *            On this day) follow, labelled as such.
 *   decade — a place and a decade drawn from the verified On-this-day
 *            catalogue: songs released then by artists from there.
 *   songs  — a "Songs about this place" list (songs-about-places.json):
 *            every song in it already carries a playability-checked video.
 *
 * A pick plays only when the SAME SONG BY THE SAME ARTIST already plays
 * somewhere else on the site with a verified video:
 *   1. the #1-hits sweep (hits-play.json), keyed exactly by chart,
 *      credited artist and title — the picks in US/GB eras are chart #1s;
 *   2. "Songs about this place", plain records only (a cover, live take
 *      or remix is a different recording, so `ver` songs never join);
 *   3. "On this day", whose videos are id-anchored to the artist and the
 *      release, matched on the song the video is (`vs`).
 * Names compare under normalizeName with an explicit non-empty check —
 * missing is never a match (standing lesson 5).
 */
import { normalizeName } from './normalizeName.mjs'

/** Chart files the hits sweep keyed its videos under, per country. */
const CHART_BY_COUNTRY = { US: 'billboard-hot-100', GB: 'uk-singles-chart' }

const VIDEO_ID = /^[\w-]{11}$/

/** Songs a journey carries; enough to listen to, never a wall. */
export const JOURNEY_TRACKS = 15
/** Fewer playable songs than this, and it is not a journey. */
export const MIN_JOURNEY_TRACKS = 5
/** Distinct artists a decade needs before it becomes a journey. */
export const MIN_DECADE_ARTISTS = 8
/** One artist never fills a journey: at most this many songs each. */
const PER_ARTIST = 2

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
 * Tags that name a place, a decade or a listening habit rather than a
 * sound — never shown as a journey's genre.
 */
const NOT_A_GENRE = new Set([
  'american', 'usa', 'us', 'united states', 'british', 'uk', 'english', 'scottish',
  'welsh', 'irish', 'german', 'deutsch', 'french', 'japanese', 'swedish', 'canadian',
  'australian', 'brazilian', 'italian', 'dutch', 'finnish', 'norwegian', 'danish',
  'belgian', 'spanish', 'jamaican', 'greek', 'turkish', 'polish', 'israeli',
  'argentine', 'argentinian', 'mexican', 'portuguese', 'swiss', 'austrian',
  'filipino', 'taiwanese', 'chinese', 'korean', 'russian', 'icelandic', 'seen live',
  'female vocalists', 'male vocalists', 'female vocalist', 'male vocalist',
])

function isGenreTag(tag) {
  const t = (tag ?? '').trim().toLowerCase()
  return t !== '' && !NOT_A_GENRE.has(t) && !/^(\d0s|\d{4}s|\d{2}s)$/.test(t)
}

/**
 * Index the verified sources. `otdItems` is a flat list of On-this-day
 * items (any shard); only items carrying a well-formed verified video
 * (`v`) count, each video once.
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
  const released = []
  const seen = new Set()
  for (const item of otdItems ?? []) {
    if (!item?.v || !VIDEO_ID.test(item.v) || seen.has(item.v)) continue
    seen.add(item.v)
    released.push(item)
    const key = songKey(item.n, item.vs ?? item.t)
    if (key && !otd.has(key)) otd.set(key, { videoId: item.v })
  }
  return { hits, songs, otd, released }
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

/** Deterministic tiebreak, so a rebuild picks the same songs. */
function hash(value) {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Up to `limit` released songs from one place and span, spread across
 * its years (round robin, one year at a time) with at most PER_ARTIST
 * songs per artist. `taken` holds videos and artist counts already used.
 */
function spreadAcrossYears(items, limit, taken) {
  const byYear = new Map()
  for (const item of [...items].sort((a, b) => a.y - b.y || hash(a.v) - hash(b.v))) {
    byYear.set(item.y, [...(byYear.get(item.y) ?? []), item])
  }
  const picked = []
  let progress = true
  while (picked.length < limit && progress) {
    progress = false
    for (const queue of byYear.values()) {
      while (queue.length > 0) {
        const item = queue.shift()
        const artist = normalizeName(item.n)
        if (taken.videos.has(item.v) || (taken.artists.get(artist) ?? 0) >= PER_ARTIST) continue
        taken.videos.add(item.v)
        taken.artists.set(artist, (taken.artists.get(artist) ?? 0) + 1)
        picked.push(item)
        progress = true
        break
      }
      if (picked.length >= limit) break
    }
  }
  return picked.sort((a, b) => a.y - b.y)
}

/** A released song as a journey track. */
function releasedTrack(item, group) {
  const track = { artist: item.n, title: item.vs ?? item.t, videoId: item.v, year: item.y, group }
  if (item.a) track.mbid = item.a
  return track
}

/**
 * Tags shared by at least `minArtists` artists across the catalogue —
 * the genre vocabulary. Folksonomy one-offs ("death by plane crash")
 * never reach a journey's label.
 */
export function genreVocabulary(items, minArtists = 25) {
  const artistsByTag = new Map()
  for (const item of items) {
    const artist = normalizeName(item.n)
    if (!artist) continue
    for (const tag of item.g ?? []) {
      const key = tag.trim().toLowerCase()
      if (!isGenreTag(key)) continue
      if (!artistsByTag.has(key)) artistsByTag.set(key, new Set())
      artistsByTag.get(key).add(artist)
    }
  }
  return new Set(
    [...artistsByTag.entries()].filter(([, artists]) => artists.size >= minArtists).map(([tag]) => tag),
  )
}

/** The commonest genres among a set of songs, from the shared vocabulary. */
export function topGenres(items, vocabulary, count = 3) {
  const tally = new Map()
  for (const item of items) {
    for (const tag of new Set((item.g ?? []).map((t) => t.trim().toLowerCase()))) {
      if (isGenreTag(tag) && (!vocabulary || vocabulary.has(tag))) {
        tally.set(tag, (tally.get(tag) ?? 0) + 1)
      }
    }
  }
  return [...tally.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([tag]) => tag)
}

/** Released songs a journey may carry: no demoted family (owner ruling). */
function eligible(items, demotedTags) {
  return items.filter(
    (item) => !(item.g ?? []).some((tag) => demotedTags.has(tag.trim().toLowerCase())),
  )
}

/**
 * Era journeys from the "What was playing" entries: the picks that play,
 * then songs released in that place and span. Only the playable — and
 * only eras that reach MIN_JOURNEY_TRACKS.
 */
export function buildEraJourneys(entries, index, countryName, demotedTags = new Set()) {
  const released = eligible(index.released, demotedTags)
  return entries.flatMap((entry) => {
    const taken = { videos: new Set(), artists: new Map() }
    const picks = []
    for (const item of entry.items) {
      const video = verifiedVideoFor(index, entry.country, item.artist, item.work)
      if (!video || !VIDEO_ID.test(video.videoId) || taken.videos.has(video.videoId)) continue
      taken.videos.add(video.videoId)
      const artist = normalizeName(item.artist)
      taken.artists.set(artist, (taken.artists.get(artist) ?? 0) + 1)
      const track = { artist: item.artist, title: item.work, videoId: video.videoId, group: 'pick', source: video.source }
      if (item.note) track.note = item.note
      if (video.live) track.live = true
      picks.push(track)
    }
    const more = spreadAcrossYears(
      released.filter((item) => item.c === entry.country && item.y >= entry.from && item.y <= entry.to),
      Math.max(0, JOURNEY_TRACKS - picks.length),
      taken,
    ).map((item) => releasedTrack(item, 'more'))
    const tracks = [...picks, ...more]
    if (tracks.length < MIN_JOURNEY_TRACKS) return []
    return [
      {
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
        picks: picks.length,
        tracks,
        count: tracks.length,
        thumb: tracks[0].videoId,
      },
    ]
  })
}

/**
 * Decade journeys: a place and a decade with at least MIN_DECADE_ARTISTS
 * artists among its verified releases. A decade an era journey of the
 * same place already covers (5+ years overlap) is skipped, never shown
 * twice.
 */
export function buildDecadeJourneys(index, countryName, eraJourneys, demotedTags = new Set()) {
  const groups = new Map()
  const released = eligible(index.released, demotedTags)
  const vocabulary = genreVocabulary(released)
  for (const item of released) {
    if (!item.c || !Number.isInteger(item.y)) continue
    const decade = Math.floor(item.y / 10) * 10
    const key = `${item.c}|${decade}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const journeys = []
  for (const [key, items] of groups) {
    const [code, decadeText] = key.split('|')
    const decade = Number(decadeText)
    const artists = new Set(items.map((item) => normalizeName(item.n)).filter(Boolean))
    if (artists.size < MIN_DECADE_ARTISTS) continue
    const covered = eraJourneys.some(
      (era) =>
        era.code === code &&
        Math.min(era.to, decade + 9) - Math.max(era.from, decade) + 1 >= 5,
    )
    if (covered) continue
    const picked = spreadAcrossYears(items, JOURNEY_TRACKS, { videos: new Set(), artists: new Map() })
    if (picked.length < MIN_JOURNEY_TRACKS) continue
    const place = countryName(code)
    journeys.push({
      id: `${code}-${decade}s`,
      kind: 'decade',
      code,
      place,
      from: decade,
      to: decade + 9,
      title: `${place} in the ${decade}s`,
      genres: topGenres(picked, vocabulary),
      artistCount: artists.size,
      tracks: picked.map((item) => releasedTrack(item, 'more')),
      count: picked.length,
      thumb: picked[0].v,
    })
  }
  return journeys.sort((a, b) => a.place.localeCompare(b.place) || a.from - b.from)
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
