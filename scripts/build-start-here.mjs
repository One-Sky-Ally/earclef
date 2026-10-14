/**
 * Build lib/artist/start-here.json — each roster artist's verified songs
 * beyond their hand-picked videos (rules in scripts/lib/startHere.mjs).
 * Local committed files only, deterministic; runs in `npm run build`:
 *   node scripts/build-start-here.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildStartHere } from './lib/startHere.mjs'

const ROOT = process.cwd()
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

const roster = readdirSync(join(ROOT, 'content'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => read(`content/${file}`))
  .map((artist) => ({
    slug: artist.slug,
    mbid: artist.integrations?.setlistfm?.mbid || null,
    curated: (artist.watch?.videos ?? []).map((video) => video.youtubeId),
    curatedTitles: (artist.watch?.videos ?? []).map((video) => video.title),
  }))

const otdItems = []
for (let month = 1; month <= 12; month++) {
  const shard = read(`lib/explore/on-this-day/${String(month).padStart(2, '0')}.json`)
  for (const day of Object.values(shard.days)) otdItems.push(...(day.items ?? []))
}
const songPlaces = read('lib/explore/songs-about-places.json').places

const bySlug = buildStartHere(roster, otdItems, songPlaces)
const sorted = Object.fromEntries(Object.keys(bySlug).sort().map((slug) => [slug, bySlug[slug]]))
writeFileSync(join(ROOT, 'lib', 'artist', 'start-here.json'), JSON.stringify(sorted) + '\n')
const songs = Object.values(sorted).reduce((sum, list) => sum + list.length, 0)
console.log(`start here: ${songs} verified songs for ${Object.keys(sorted).length} artists -> lib/artist/start-here.json`)
