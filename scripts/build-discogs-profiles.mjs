/**
 * ADDENDUM PASS (owner-approved Sep 1, 2026: "an independent
 * corroborating fact is worth an hour").
 *
 * Discogs exposes NO structured location or career-date field on an
 * artist — the endpoint carries name, realname, a free-text `profile`,
 * namevariations and urls, nothing more. But the profile follows a
 * strong convention: Racciatti's reads "Italian-born Uruguayan
 * bandoneonist, composer and orchestra director (18 October 1918 - 27
 * May 2000)", and those years match his MusicBrainz life-span exactly.
 *
 * That is the independent corroborating fact standing lesson 3 asks
 * for: identity resting on a unique name ALONE is weak, but a unique
 * name whose Discogs biography carries the same birth/death years as
 * MusicBrainz is a second, independent leg.
 *
 * ONLY RUNS FOR `name-unique` ARTISTS — the id-crosswalk and
 * wikidata-hop tiers are already ID-level and need no shoring up.
 *
 * THIS PASS NEVER DECIDES ANYTHING. It records what the profile says
 * and whether it agrees with MusicBrainz; Stage 3 weighs it, and a
 * disagreement is surfaced to the owner rather than auto-rejected —
 * profiles are prose written by volunteers and a mismatch can as
 * easily be a typo as a wrong artist.
 *
 * MUST NOT RUN CONCURRENTLY WITH build-rg-dating-evidence.mjs — both
 * spend the same 60 req/min Discogs budget, and two at once earns 429s
 * for both. Run this after the sweep finishes.
 *
 * Usage: node scripts/build-discogs-profiles.mjs [--limit N]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE_DIR = 'data/rg-dating-evidence'
const OUT_PATH = 'data/rg-dating-profiles.json'
const USER_AGENT =
  'EarClefExplore/0.1 (https://earclef.com; fiohmemorial@gmail.com)'
const DELAY_MS = 1050
const MAX_RETRIES = 4

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function discogsToken() {
  if (process.env.DISCOGS_TOKEN) return process.env.DISCOGS_TOKEN
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DISCOGS_TOKEN='))
  return line ? line.slice('DISCOGS_TOKEN='.length).trim() : null
}

let lastRequestAt = 0
async function paced() {
  const wait = lastRequestAt + DELAY_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

async function discogsJson(url, token) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await paced()
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Authorization: `Discogs token=${token}`,
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 60
        await sleep(retryAfter * 1000)
        continue
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      await sleep(2000 * attempt)
    }
  }
  return null
}

/**
 * Life years out of profile prose. CONSERVATIVE BY DESIGN: only shapes
 * that unambiguously denote a lifespan or a birth are accepted, and
 * anything else returns nothing. A wrong extraction here would create a
 * false corroboration, which is worse than no corroboration at all —
 * so "no pattern matched" is a perfectly good answer.
 *
 * Years are bounded to 1700–2026: a four-digit number in a profile is
 * as likely to be a catalogue number or an address as a year.
 */
const YEAR = '(1[789]\\d{2}|20[0-2]\\d)'
const PATTERNS = [
  // "(18 October 1918 - 27 May 2000)" / "(1918-2000)" / "1918 – 2000"
  new RegExp(`${YEAR}\\s*[-–—]\\s*(?:\\d{1,2}\\s+\\w+\\s+)?${YEAR}`),
  // "(b. 1918)" / "born 1918" / "Born: 1918"
  new RegExp(`\\b(?:b\\.|born:?)\\s*(?:\\d{1,2}\\s+\\w+\\s+)?${YEAR}`, 'i'),
]

function lifeYearsFromProfile(profile) {
  const text = (profile ?? '').replace(/\r/g, ' ')
  if (!text) return null
  const span = PATTERNS[0].exec(text)
  if (span) {
    const born = Number(span[1])
    const died = Number(span[2])
    // An end before a beginning is a parse, not a life.
    if (died >= born) return { born, died }
  }
  const birth = PATTERNS[1].exec(text)
  if (birth) return { born: Number(birth[1]), died: null }
  return null
}

/**
 * Does the profile agree with MusicBrainz?
 *
 * MB's stored `cs` for a PERSON is birth + 15 (the career-start proxy
 * this project applies everywhere), so the comparison has to undo that
 * offset rather than compare raw numbers. A ±2 tolerance absorbs the
 * usual off-by-one disagreements between sources.
 */
const PERSON_CAREER_OFFSET_YEARS = 15
function agreement(mb, profile) {
  if (!profile) return 'no-dates-in-profile'
  const checks = []
  if (mb.cs !== null && profile.born !== null) {
    const impliedBirth = mb.cs - PERSON_CAREER_OFFSET_YEARS
    checks.push(Math.abs(impliedBirth - profile.born) <= 2)
  }
  if (mb.end !== null && profile.died !== null) {
    checks.push(Math.abs(mb.end - profile.died) <= 2)
  }
  if (checks.length === 0) return 'nothing-comparable'
  if (checks.every(Boolean)) return 'agrees'
  if (checks.some(Boolean)) return 'partial'
  return 'disagrees'
}

async function main() {
  const token = discogsToken()
  if (!token) throw new Error('DISCOGS_TOKEN not found')
  if (!existsSync(EVIDENCE_DIR)) {
    throw new Error('No evidence shards — run the Stage 2 sweep first.')
  }

  // Resume: keep anything already fetched.
  const stored = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    : { generatedAt: null, artists: {} }
  const held = stored.artists ?? {}

  const targets = []
  for (const file of readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith('.json'))) {
    const shard = JSON.parse(readFileSync(join(EVIDENCE_DIR, file), 'utf8'))
    for (const artist of shard.artists) {
      if (artist.tier !== 'name-unique' || artist.status !== 'checked') continue
      if (held[artist.id]) continue
      targets.push({
        id: artist.id,
        name: artist.name,
        discogsId: artist.discogsId,
        cs: artist.cs ?? null,
        end: artist.end ?? null,
        country: file.replace(/\.json$/, ''),
      })
    }
  }
  console.log(
    `${targets.length} name-unique artists to profile (${Object.keys(held).length} already stored)`,
  )

  let done = 0
  const tally = {}
  for (const artist of targets) {
    if (done >= LIMIT) break
    let body
    try {
      body = await discogsJson(
        `https://api.discogs.com/artists/${artist.discogsId}`,
        token,
      )
    } catch (error) {
      console.warn(`  ${artist.name}: ${error.message}`)
      continue
    }
    const profile = lifeYearsFromProfile(body?.profile)
    const verdict = agreement(artist, profile)
    tally[verdict] = (tally[verdict] ?? 0) + 1
    held[artist.id] = {
      name: artist.name,
      country: artist.country,
      discogsId: artist.discogsId,
      mbCs: artist.cs,
      mbEnd: artist.end,
      profileBorn: profile?.born ?? null,
      profileDied: profile?.died ?? null,
      /** Kept verbatim so a person can judge a disputed case. */
      profileText: (body?.profile ?? '').slice(0, 300) || null,
      realname: body?.realname || null,
      verdict,
    }
    done += 1
    if (done % 50 === 0) {
      writeFileSync(
        OUT_PATH,
        JSON.stringify({ generatedAt: new Date().toISOString(), artists: held }, null, 1) + '\n',
      )
      console.log(`  ${done}/${targets.length} · ${JSON.stringify(tally)}`)
    }
  }

  writeFileSync(
    OUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), artists: held }, null, 1) + '\n',
  )
  console.log(`\nDONE — ${done} profiled this run. Verdicts: ${JSON.stringify(tally)}`)
}

main().catch((error) => {
  console.error('profile pass failed:', error.message)
  process.exit(1)
})
