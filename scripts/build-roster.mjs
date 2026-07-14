/**
 * Snapshot the roster facts the Discover feature needs into a small JSON
 * module. Serverless functions can't read content/*.json from disk (only
 * statically imported files are bundled), so this runs before every build —
 * see package.json "build" — keeping the snapshot in sync with the roster.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CONTENT_DIR = join(process.cwd(), 'content')
const OUT_PATH = join(process.cwd(), 'lib', 'discover', 'roster.json')

const roster = readdirSync(CONTENT_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8')))
  .map((artist) => ({
    slug: artist.slug,
    name: artist.hero.name,
    identity: artist.hero.identity,
    tier: artist.tier ?? null,
    mbid: artist.integrations?.setlistfm?.mbid || null,
    membership: Boolean(artist.membership?.enabled),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(OUT_PATH, JSON.stringify(roster, null, 2) + '\n')
console.log(`roster snapshot: ${roster.length} artists -> lib/discover/roster.json`)
