/**
 * "SONGS ABOUT THIS PLACE" — STAGE 1 (owner go, Oct 12 2026): gather.
 *
 * Crawls en.wikipedia's "Songs about <place>" category tree, maps each
 * category to a globe place (scripts/lib/songsAboutPlaces.mjs), and
 * resolves every song article through Wikidata: title, performers with
 * their MusicBrainz ids (P175 → P434), first publication year (P577),
 * and the song's own MB work/recording ids when present. Articles with
 * no Wikidata performer also get the infobox "artist" line from the
 * page's wikitext, for the identity research that follows.
 *
 * Writes data/songs-about-work.json (resumable; every page fetched is
 * cached under data/songs-about-cache/). Stage 2 is
 * scripts/verify-songs-about-play.mjs. Wikipedia/Wikidata only — no
 * model, no YouTube quota.
 *
 *   node scripts/build-songs-about-places.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyCategory, isListArticle, placeMaps } from './lib/songsAboutPlaces.mjs'

const ROOT = process.cwd()
const CACHE = join(ROOT, 'data', 'songs-about-cache')
const WORK = join(ROOT, 'data', 'songs-about-work.json')
mkdirSync(CACHE, { recursive: true })
const UA = 'EarClefSongsAbout/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const ROOTS = ['Category:Songs about places', 'Category:Songs about the United States', 'Category:Songs about the United Kingdom']
const MAX_DEPTH = 6
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const cacheFile = (name) => join(CACHE, `${name.replace(/[^\w.-]+/g, '_').slice(0, 160)}.json`)

async function cachedJson(name, url) {
  const file = cacheFile(name)
  if (existsSync(file)) return readJson(file)
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) })
      if (res.ok) {
        const body = await res.json()
        writeFileSync(file, JSON.stringify(body))
        await sleep(500)
        return body
      }
      if (res.status === 404) { writeFileSync(file, 'null'); return null }
    } catch {
      // retry
    }
    await sleep(2000 * attempt)
  }
  return null
}

async function cachedText(name, url) {
  const file = cacheFile(name).replace(/\.json$/, '.txt')
  if (existsSync(file)) return readFileSync(file, 'utf8')
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) })
      if (res.ok) { const text = await res.text(); writeFileSync(file, text); await sleep(500); return text }
      if (res.status === 404) { writeFileSync(file, ''); return '' }
    } catch {
      // retry
    }
    await sleep(2000 * attempt)
  }
  return ''
}

/** Every member of a category (continuation-aware). */
async function categoryMembers(title) {
  const subcats = []
  const pages = []
  let cont = ''
  for (let page = 0; page < 10; page++) {
    const body = await cachedJson(
      `cat-${title}-${page}`,
      `https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(title)}&cmlimit=500&cmtype=subcat|page&cmnamespace=0|14&format=json${cont}`,
    )
    for (const member of body?.query?.categorymembers ?? []) {
      if (member.ns === 14) subcats.push(member.title)
      else if (member.ns === 0) pages.push(member.title)
    }
    if (!body?.continue?.cmcontinue) break
    cont = `&cmcontinue=${encodeURIComponent(body.continue.cmcontinue)}`
  }
  return { subcats, pages }
}

async function crawl() {
  const tree = {}
  const queue = ROOTS.map((title) => ({ title, depth: 0 }))
  const seen = new Set(ROOTS)
  while (queue.length) {
    const { title, depth } = queue.shift()
    const members = await categoryMembers(title)
    tree[title] = { ...members, depth }
    if (depth >= MAX_DEPTH) continue
    for (const sub of members.subcats) {
      if (!/^Category:(Songs|Music) (about|set in) /i.test(sub) || /Lists of/i.test(sub) || seen.has(sub)) continue
      seen.add(sub)
      queue.push({ title: sub, depth: depth + 1 })
    }
  }
  return tree
}

const claims = (entity, property) =>
  entity?.claims?.[property]?.map((claim) => claim.mainsnak?.datavalue?.value).filter(Boolean) ?? []

/** The infobox's artist line, markup stripped — for research, never for identity on its own. */
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

async function resolveSong(page) {
  const props = await cachedJson(
    `pp-${page}`,
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(page)}&format=json`,
  )
  const qid = Object.values(props?.query?.pages ?? {})[0]?.pageprops?.wikibase_item ?? null
  const song = { page, qid, title: null, year: null, performers: [], mbWork: null, mbRecording: null, infoboxArtist: null }
  if (qid) {
    const entity = (await cachedJson(`wd-${qid}`, `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`))?.entities?.[qid]
    song.title = entity?.labels?.en?.value ?? null
    const years = claims(entity, 'P577').map((value) => Number(String(value.time).slice(1, 5))).filter((year) => year > 1800)
    song.year = years.length ? Math.min(...years) : null
    song.mbWork = claims(entity, 'P435')[0] ?? null
    song.mbRecording = claims(entity, 'P4404')[0] ?? null
    for (const performer of claims(entity, 'P175').map((value) => value.id).slice(0, 4)) {
      const body = (await cachedJson(`wd-${performer}`, `https://www.wikidata.org/wiki/Special:EntityData/${performer}.json`))?.entities?.[performer]
      song.performers.push({ qid: performer, name: body?.labels?.en?.value ?? null, mbid: claims(body, 'P434')[0] ?? null })
    }
  }
  if (!song.title) song.title = page.replace(/\s*\([^)]*\)$/, '')
  if (!song.performers.some((performer) => performer.mbid)) {
    const wikitext = await cachedText(`wt-${page}`, `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(page)}&action=raw`)
    song.infoboxArtist = infoboxArtist(wikitext)
  }
  return song
}

async function main() {
  const codes = readJson(join(ROOT, 'lib/explore/country-artists-index.json')).codes
  const presence = readJson(join(ROOT, 'lib/explore/presence-edges.json'))
  const countryNames = {}
  const cities = new Set()
  for (const artist of Object.values(presence.artists)) {
    if (artist.home && artist.homeName) countryNames[artist.home] = artist.homeName
    for (const chapter of artist.chapters ?? []) {
      if (chapter.countryName) countryNames[chapter.country] = chapter.countryName
      if (chapter.place) cities.add(`${chapter.country}|${chapter.place}`)
    }
  }
  const maps = placeMaps({
    codes,
    countryNames,
    usStates: readJson(join(ROOT, 'lib/explore/us-states.json')).states,
    ukNations: readJson(join(ROOT, 'lib/explore/uk-nations.json')).states,
    cities: [...cities],
  })

  console.log('crawling categories…')
  const tree = await crawl()
  const byPage = new Map()
  let matched = 0
  const unmatched = []
  for (const [title, category] of Object.entries(tree)) {
    const place = classifyCategory(title, maps)
    if (!place) { unmatched.push(title); continue }
    matched++
    for (const page of category.pages) {
      if (isListArticle(page)) continue
      const held = byPage.get(page) ?? { places: [] }
      if (!held.places.some((p) => p.key === place.key)) held.places.push(place)
      byPage.set(page, held)
    }
  }
  console.log(`categories ${Object.keys(tree).length}, matched ${matched}, songs ${byPage.size}`)

  const work = existsSync(WORK) ? readJson(WORK) : { songs: {} }
  const pages = [...byPage.keys()].sort()
  let done = 0
  for (const page of pages) {
    if (!work.songs[page]) {
      work.songs[page] = { ...(await resolveSong(page)), places: byPage.get(page).places }
      if (++done % 25 === 0) {
        writeFileSync(WORK, JSON.stringify({ generatedAt: new Date().toISOString(), unmatchedCategories: unmatched, songs: work.songs }, null, 1))
        process.stdout.write(`resolved ${done} new (${Object.keys(work.songs).length}/${pages.length})\n`)
      }
    } else {
      work.songs[page] = { ...work.songs[page], places: byPage.get(page).places }
    }
  }
  const songs = Object.fromEntries(pages.map((page) => [page, work.songs[page]]))
  writeFileSync(WORK, JSON.stringify({ generatedAt: new Date().toISOString(), unmatchedCategories: unmatched, songs }, null, 1))
  const list = Object.values(songs)
  console.log(`done: ${list.length} songs; with a Wikidata item ${list.filter((s) => s.qid).length}; with an MB performer ${list.filter((s) => s.performers.some((p) => p.mbid)).length}; infobox artist only ${list.filter((s) => !s.performers.some((p) => p.mbid) && s.infoboxArtist).length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
