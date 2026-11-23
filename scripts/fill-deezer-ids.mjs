#!/usr/bin/env node
/**
 * Fill integrations.deezer.artistIds in content/<slug>.json. The feed
 * snapshot reads the artist's Deezer catalogue through these ids so a
 * release can open on Deezer itself instead of a search (owner, Nov 23
 * 2026).
 *
 * A Deezer page counts only on EVIDENCE, never a name search (the
 * add-artist channel rule), and on two checks:
 *   1. MusicBrainz links it to the artist (url-rels), and
 *   2. it is the same artist: the page carries the artist's name AND
 *      shares releases with their own Apple Music catalogue (two titles,
 *      or every title on a page with only one) — or, under another credit
 *      ("Bob Marley & The Wailers"), shares five. MusicBrainz links can be
 *      wrong — Nov 23 2026: AURORA's record also linked the UK trance act
 *      Aurora, and King Gizzard's a page now named "Grand Theft Auto VI".
 *
 *   node scripts/fill-deezer-ids.mjs            every artist
 *   node scripts/fill-deezer-ids.mjs bjork …    only these slugs
 *
 * No page passes → the field is removed, never guessed. MusicBrainz,
 * Apple or Deezer not answering → the file is left as it was.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CONTENT_DIR = join(process.cwd(), 'content')
const UA = 'EarClefResearch/0.1 (https://earclef.com)'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Deezer artist ids in MusicBrainz url-rels, in their order, deduplicated. */
export function deezerArtistIds(relations) {
  const ids = (relations ?? []).flatMap((relation) => {
    const resource = relation?.url?.resource ?? ''
    const id = resource.match(/^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d{1,12})\/?$/)?.[1]
    return id ? [id] : []
  })
  return [...new Set(ids)]
}

const FOLDS = { æ: 'ae', œ: 'oe', ø: 'o', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' }

/** An artist name compared across services: case, accents, "and"/"&" and punctuation set aside. */
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[æœøßłđðþı]/g, (letter) => FOLDS[letter] ?? letter)
    .replace(/\band\b/g, '&')
    .replace(/[^\p{L}\p{N}&]+/gu, '')
}

/** A release title compared across catalogues (as lib/listen/releaseLinks titleKey). */
export function titleKey(title) {
  return String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+-\s+(single|ep)\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Shared releases that make a page under another credit the artist's own ("Bob Marley & The Wailers"). */
const SHARED_UNDER_ANOTHER_NAME = 5

/**
 * The same artist: the page carries the artist's name and shares
 * releases with their own catalogue — two titles, or all of them when the
 * page holds fewer than two — or, under another credit, shares at least
 * five.
 */
export function samePage(artistName, catalogTitles, page) {
  const own = new Set(catalogTitles.map(titleKey).filter(Boolean))
  const titles = [...new Set(page.titles.map(titleKey).filter(Boolean))]
  if (titles.length === 0) return false
  const shared = titles.filter((title) => own.has(title)).length
  if (nameKey(page.name) !== nameKey(artistName)) return shared >= SHARED_UNDER_ANOTHER_NAME
  return shared >= Math.min(2, titles.length)
}

async function getJson(url, valid) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const body = await res.json()
        // Busy MusicBrainz and rate-limited Deezer both answer 200 with an error body.
        if (valid(body)) return body
      } else if (res.status === 404) {
        return null
      }
    } catch {
      // network flake: retry below
    }
    await sleep(3000 * attempt)
  }
  return undefined
}

async function deezerPage(id) {
  const artist = await getJson(`https://api.deezer.com/artist/${id}`, (body) => typeof body.name === 'string')
  const albums = await getJson(`https://api.deezer.com/artist/${id}/albums?limit=100`, (body) => Array.isArray(body.data))
  if (artist === undefined || albums === undefined) return undefined
  return { name: artist?.name ?? '', titles: (albums?.data ?? []).map((album) => album.title) }
}

async function main() {
  const only = new Set(process.argv.slice(2))
  const files = readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.json'))
    .filter((file) => only.size === 0 || only.has(file.replace(/\.json$/, '')))
  const tally = { linked: 0, none: 0, failed: 0, refused: 0 }
  for (const file of files) {
    const path = join(CONTENT_DIR, file)
    const content = JSON.parse(readFileSync(path, 'utf8'))
    const mbid = content.integrations?.setlistfm?.mbid
    const itunesId = content.integrations?.itunes?.artistId
    if (!mbid || !itunesId) continue
    const artist = await getJson(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, (body) => Array.isArray(body.relations))
    await sleep(1100)
    // Apple sometimes answers with no collections, and the whole
    // catalogue a moment later: an empty answer is no answer.
    const catalog = await getJson(
      `https://itunes.apple.com/lookup?id=${itunesId}&entity=album&limit=200`,
      (body) => Array.isArray(body.results) && body.results.some((result) => result.wrapperType === 'collection'),
    )
    await sleep(3000) // iTunes: ~20 requests a minute
    if (!artist || !catalog) {
      tally.failed++
      console.log(`${content.slug}: MusicBrainz or Apple did not answer — left as it was`)
      continue
    }
    const catalogTitles = catalog.results.flatMap((result) => (result.collectionName ? [result.collectionName] : []))
    const kept = []
    let unanswered = false
    for (const id of deezerArtistIds(artist.relations)) {
      const page = await deezerPage(id)
      await sleep(200)
      if (page === undefined) {
        unanswered = true
        break
      }
      if (samePage(content.hero.name, catalogTitles, page)) kept.push(id)
      else {
        tally.refused++
        console.log(`${content.slug}: refused Deezer ${id} ("${page.name}", ${page.titles.length} releases) — not the same artist`)
      }
    }
    if (unanswered) {
      tally.failed++
      console.log(`${content.slug}: Deezer did not answer — left as it was`)
      continue
    }
    const rest = Object.fromEntries(Object.entries(content.integrations).filter(([key]) => key !== 'deezer'))
    const integrations = kept.length > 0 ? { ...rest, deezer: { artistIds: kept } } : rest
    writeFileSync(path, JSON.stringify({ ...content, integrations }, null, 2) + '\n')
    tally[kept.length > 0 ? 'linked' : 'none']++
    console.log(`${content.slug}: ${kept.length > 0 ? kept.join(', ') : 'no Deezer page passed'}`)
  }
  console.log(
    `${tally.linked} with Deezer ids, ${tally.none} without, ${tally.refused} pages refused, ${tally.failed} not answered`,
  )
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
