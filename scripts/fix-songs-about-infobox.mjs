/**
 * One-off repair for data/songs-about-work.json: recompute each song's
 * infobox artist line from the cached wikitext with the corrected
 * regex (an empty "| artist =" line used to swallow the next line).
 * Idempotent; reads the stage-1 cache only, no network.
 *   node scripts/fix-songs-about-infobox.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const WORK = join(ROOT, 'data', 'songs-about-work.json')
const CACHE = join(ROOT, 'data', 'songs-about-cache')
const cacheFile = (name) => join(CACHE, `${name.replace(/[^\w.-]+/g, '_').slice(0, 160)}.txt`)

function infoboxArtist(wikitext) {
  const match = wikitext.match(/^[ \t]*\|[ \t]*artist[ \t]*=[ \t]*(.+)$/im)
  if (!match) return null
  return match[1]
    .replace(/<ref[^>]*>.*?<\/ref>/gis, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{(?:hlist|flatlist|ubl|unbulleted list)\|([^}]*)\}\}/gi, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null
}

const work = JSON.parse(readFileSync(WORK, 'utf8'))
let fixed = 0
const songs = Object.fromEntries(
  Object.entries(work.songs).map(([page, song]) => {
    const file = cacheFile(`wt-${page}`)
    if (!existsSync(file)) return [page, song]
    const artist = infoboxArtist(readFileSync(file, 'utf8'))
    if (artist !== song.infoboxArtist) fixed++
    return [page, { ...song, infoboxArtist: artist }]
  }),
)
writeFileSync(WORK, JSON.stringify({ ...work, songs }, null, 1))
console.log(`infobox artist recomputed; ${fixed} changed`)
