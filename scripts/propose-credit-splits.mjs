/**
 * Proposal generator for "/" joint-credit gap-fill entries — REPORT
 * ONLY, writes nothing to any dataset (owner ruling: no auto-split;
 * the owner approves each split before data changes).
 *
 *   node scripts/propose-credit-splits.mjs
 *
 * For each gap-fill name containing "/": split on the slash, look
 * each member up on Discogs (accepted only on EXACT normalized name
 * equality — no fuzzy), and emit a proposal with whatever ids were
 * found. Output: data/credit-split-proposals.json + stdout.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, 'data', 'credit-split-proposals.json')

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

const token = env('DISCOGS_TOKEN')
if (!token) throw new Error('DISCOGS_TOKEN required (.env.local)')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

async function exactDiscogsArtist(name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(name)}&per_page=10&token=${token}`,
        {
          headers: { 'User-Agent': 'EarClefSplitProposals/0.1' },
          signal: AbortSignal.timeout(15000),
        },
      )
      await sleep(1100)
      if (res.status === 429) {
        await sleep(5000)
        continue
      }
      if (!res.ok) return null
      const body = await res.json()
      for (const result of body.results ?? []) {
        const cleaned = (result.title ?? '').replace(/\s*\(\d+\)\s*$/, '')
        if (result.id && normalizeName(cleaned) === normalizeName(name)) {
          return { id: result.id, title: result.title }
        }
      }
      return null
    } catch (error) {
      console.error(`  lookup "${name}" attempt ${attempt}: ${error.message}`)
      await sleep(3000 * attempt)
    }
  }
  return null
}

const dataset = JSON.parse(
  readFileSync(join(ROOT, 'lib', 'explore', 'extra-artists.json'), 'utf8'),
)

const proposals = []
for (const [country, artists] of Object.entries(dataset.countries)) {
  for (const artist of artists) {
    if (!artist.name.includes('/')) continue
    const members = artist.name
      .split('/')
      .map((segment) => segment.replace(/\*\s*$/, '').trim())
      .filter((segment) => segment.length > 1)
    const lookups = []
    for (const member of members) {
      const match = await exactDiscogsArtist(member)
      lookups.push({
        member,
        discogsArtistId: match?.id ?? null,
        discogsTitle: match?.title ?? null,
      })
    }
    proposals.push({
      country,
      creditString: artist.name,
      currentIds: {
        discogsArtistId: artist.discogsArtistId,
        wikidataId: artist.wikidataId,
      },
      proposedMembers: lookups,
    })
    console.log(
      `${country} | ${artist.name}\n${lookups
        .map(
          (l) =>
            `   -> ${l.member} ${l.discogsArtistId ? `(dg:${l.discogsArtistId})` : '(no exact Discogs artist match)'}`,
        )
        .join('\n')}`,
    )
  }
}

writeFileSync(OUT, `${JSON.stringify({ proposals }, null, 1)}\n`)
console.log(`\n${proposals.length} proposals written to ${OUT} — NOTHING was changed in any dataset.`)
