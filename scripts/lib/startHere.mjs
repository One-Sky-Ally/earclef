/**
 * "Start here" on an artist page (UI handoff Phase 1, Oct 2026): the
 * artist's own songs that already play on the site, beyond the videos
 * hand-picked in their content file. Two verified sources, joined by
 * MusicBrainz artist id ONLY (a name is not an identity):
 *   - On this day: videos id-anchored to the artist and the release;
 *   - Songs about this place: playability-checked, plain records only
 *     (a live take or cover is a different recording).
 * Missing ids never match (standing lesson 5).
 */

const VIDEO_ID = /^[\w-]{11}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * One song once: "2 + 2 = 5 (The Lukewarm.)" and "2+2=5" are the same
 * song — bracketed decorations and punctuation never make a new one.
 */
export function sameSongKey(title) {
  return (title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Songs kept per artist — enough for "show more", never a catalogue. */
export const START_HERE_EXTRA = 12

/**
 * @param roster  [{ slug, mbid, curated: [videoId], curatedTitles?: [title] }]
 * @param otdItems flat On-this-day items
 * @param songPlaces songs-about-places `places`
 * @returns { [slug]: [{ v, t, y?, r?, s }] }
 */
export function buildStartHere(roster, otdItems, songPlaces) {
  const bySlug = {}
  const slugByMbid = new Map()
  for (const artist of roster) {
    if (artist.mbid && UUID.test(artist.mbid)) slugByMbid.set(artist.mbid, artist)
  }
  const seen = new Map()
  const add = (artist, song) => {
    if (!VIDEO_ID.test(song.v ?? '') || !song.t) return
    const used =
      seen.get(artist.slug) ??
      new Set([
        ...(artist.curated ?? []),
        ...(artist.curatedTitles ?? []).map(sameSongKey).filter(Boolean),
      ])
    seen.set(artist.slug, used)
    const key = sameSongKey(song.t)
    if (used.has(song.v) || (key && used.has(key))) return
    used.add(song.v)
    if (key) used.add(key)
    ;(bySlug[artist.slug] ??= []).push(song)
  }
  for (const item of otdItems ?? []) {
    const artist = item?.a ? slugByMbid.get(item.a) : undefined
    if (!artist || !item.v) continue
    add(artist, { v: item.v, t: item.vs ?? item.t, y: item.y, r: item.t, s: 'on-this-day' })
  }
  for (const place of Object.values(songPlaces ?? {})) {
    for (const song of place.songs ?? []) {
      const artist = song.mbid ? slugByMbid.get(song.mbid) : undefined
      if (!artist || song.ver) continue
      add(artist, { v: song.v, t: song.t.replace(/^"|"$/g, ''), ...(song.y ? { y: song.y } : {}), s: 'songs-about' })
    }
  }
  for (const slug of Object.keys(bySlug)) {
    bySlug[slug] = bySlug[slug]
      .sort((a, b) => (a.y ?? 9999) - (b.y ?? 9999) || a.t.localeCompare(b.t))
      .slice(0, START_HERE_EXTRA)
  }
  return bySlug
}
