/**
 * "SONGS ABOUT THIS PLACE" — THE WEEKLY RE-CHECK (owner, Nov 28 2026:
 * "Only keep the small weekly re-check of the videos already listed, so
 * it stays within the 30-day rule. Don't spend time or searches growing
 * it.").
 *
 * Asks YouTube about every video already listed in
 * lib/explore/songs-about-places.json — one videos.list call (1 unit)
 * per 50 ids, about 25 units for the whole list, never a search — and
 * takes off each song whose video is no longer public, embeddable and
 * song-length, or has turned out to be a livestream recording. Nothing
 * is added and nothing is re-ranked: a full rebuild is
 * scripts/verify-songs-about-play.mjs, which is not run any more unless
 * the owner asks. The file's videosCheckedAt says when YouTube last
 * vouched for every video in it; the refresh runs this weekly, so no
 * listed video goes 30 days unchecked.
 *
 *   node --import ./scripts/test/resolve-ts.mjs --env-file=.env.local scripts/recheck-songs-about.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withoutDeadVideos } from './lib/songsAboutPlaces.mjs'
import { playableSetAll, QuotaError } from '../lib/play/channelSongs.ts'
import { isBroadcast } from '../lib/discover/song.ts'

const OUT = join(process.cwd(), 'lib', 'explore', 'songs-about-places.json')
const DRY = process.argv.includes('--dry')

async function main() {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY missing — run with --env-file=.env.local')
  const file = JSON.parse(readFileSync(OUT, 'utf8'))
  const ids = [...new Set(Object.values(file.places).flatMap((place) => place.songs.map((song) => song.v)))]
  const { playable, meta } = await playableSetAll(ids, key)
  const alive = new Set(ids.filter((id) => playable.has(id) && !isBroadcast(meta.get(id))))
  const { places, dropped } = withoutDeadVideos(file.places, alive)
  const units = Math.ceil(ids.length / 50)
  console.log(`${ids.length} listed videos checked (${units} units, no searches): ${alive.size} still play`)
  for (const row of dropped) {
    const why = meta.has(row.v) ? 'no longer plays here' : 'gone from YouTube'
    console.log(`  off: ${row.place} · "${row.t}" — ${row.a} (${row.v}, ${why})`)
  }
  if (DRY) {
    console.log('--dry: nothing written')
    return
  }
  const next = { ...file, videosCheckedAt: new Date().toISOString(), places }
  writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`)
  console.log(`written: ${dropped.length} song rows off, videosCheckedAt ${next.videosCheckedAt}`)
}

main().catch((error) => {
  if (error instanceof QuotaError) {
    console.error('YouTube quota is spent for today — nothing written; run it again tomorrow.')
  } else {
    console.error('Songs-about re-check failed:', error)
  }
  process.exit(1)
})
