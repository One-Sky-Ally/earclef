/**
 * The search budget's books (owner go, Nov 19 2026). The project may run
 * 100 YouTube searches a day (search.list's own bucket since Jun 1 2026,
 * reset at midnight Pacific), shared by every visitor and the overnight
 * job. Three records live here:
 *
 *   log/{date}/{kind}-{time}-{rand}  one key per search attempt, so the
 *       day's count is a key listing: no read-modify-write races.
 *       kind: 's' live search · 'w' overnight search · 'r' refused (429).
 *       Dates are Pacific, matching Google's reset.
 *   wanted/{mbid}/{decade}  an artist a visitor's queue needed a search
 *       for and did not get one: the visit's allowance was spent, or the
 *       day's cap was. The overnight job spends the day's leftovers here
 *       first, so tomorrow's visitor finds the answer waiting.
 *
 * Every write is best-effort: losing a log line loses a count, never a
 * song. Relative imports only: bundled into Netlify functions.
 */
import { getStore } from '@netlify/blobs'

export type SearchKind = 's' | 'w' | 'r'

export interface DayCount {
  date: string
  live: number
  overnight: number
  refused: number
}

export interface WantedArtist {
  mbid: string
  decade: string
  name: string
  asks: number
  at: string
}

const STORE = 'search-budget'

/**
 * Eventual consistency, like every other store on the site: a count read
 * a minute stale costs at most a search or two of the RESERVE, and strong
 * reads have never been exercised in this deployment.
 */
function store() {
  return getStore({ name: STORE, consistency: 'eventual' })
}

/** YYYY-MM-DD in Pacific time — the day Google's search quota counts. */
export function pacificDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

export async function recordSearch(kind: SearchKind): Promise<void> {
  const now = new Date()
  const key = `log/${pacificDate(now)}/${kind}-${now.toISOString()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    await store().setJSON(key, { kind })
  } catch {
    // Best-effort bookkeeping.
  }
}

function tally(date: string, keys: string[]): DayCount {
  const count = (kind: SearchKind) => keys.filter((key) => key.startsWith(`log/${date}/${kind}-`)).length
  return { date, live: count('s'), overnight: count('w'), refused: count('r') }
}

async function logKeys(prefix: string): Promise<string[]> {
  const { blobs } = await store().list({ prefix })
  return blobs.map((blob) => blob.key)
}

/** Searches attempted so far today (live + overnight; refusals apart). */
export async function searchesToday(): Promise<DayCount> {
  const date = pacificDate()
  return tally(date, await logKeys(`log/${date}/`))
}

/** Per-day counts, newest first, for the owner's look at the books. */
export async function dailyCounts(): Promise<DayCount[]> {
  const keys = await logKeys('log/')
  const dates = [...new Set(keys.map((key) => key.split('/')[1]))].sort().reverse()
  return dates.map((date) => tally(date, keys))
}

/** Drops log lines older than `keepDays` — the books need weeks, not years. */
export async function pruneLog(keepDays = 90): Promise<number> {
  const cutoff = pacificDate(new Date(Date.now() - keepDays * 86_400_000))
  const stale = (await logKeys('log/')).filter((key) => key.split('/')[1] < cutoff)
  await Promise.all(stale.map((key) => store().delete(key).catch(() => undefined)))
  return stale.length
}

const wantedKey = (mbid: string, decade: string) => `wanted/${mbid}/${decade}`

export async function markWanted(mbid: string, decade: string, name: string): Promise<void> {
  try {
    const held = (await store().get(wantedKey(mbid, decade), { type: 'json' })) as WantedArtist | null
    await store().setJSON(wantedKey(mbid, decade), {
      mbid,
      decade,
      name,
      asks: (held?.asks ?? 0) + 1,
      // The LAST time a visitor needed it: unasked for 30 days → dropped.
      at: new Date().toISOString(),
    } satisfies WantedArtist)
  } catch {
    // Best-effort: the next visit marks it again.
  }
}

export async function clearWanted(mbid: string, decade: string): Promise<void> {
  try {
    await store().delete(wantedKey(mbid, decade))
  } catch {
    // Stays listed; the job re-checks it from cache next time.
  }
}

/** Wanted entries read per night — bounds the job's Blobs reads. */
const WANTED_READ_CAP = 600
/** A wanted artist nobody asked about again for this long is dropped. */
const WANTED_MAX_AGE_MS = 30 * 86_400_000
const READ_BATCH = 50

/**
 * Wanted artists, most-asked first, then oldest. Reads a window of
 * WANTED_READ_CAP keys starting at a random place, so a long list is
 * covered over the nights rather than always from the same MBIDs (code
 * review, Nov 19 2026). Entries in the window older than 30 days are
 * deleted as they are read.
 */
export async function wantedArtists(limit: number): Promise<WantedArtist[]> {
  const keys = await logKeys('wanted/')
  const start = keys.length > WANTED_READ_CAP ? Math.floor(Math.random() * keys.length) : 0
  const window = [...keys.slice(start), ...keys.slice(0, start)].slice(0, WANTED_READ_CAP)
  const rows: WantedArtist[] = []
  for (let at = 0; at < window.length; at += READ_BATCH) {
    const batch = await Promise.all(
      window
        .slice(at, at + READ_BATCH)
        .map((key) => store().get(key, { type: 'json' }).catch(() => null) as Promise<WantedArtist | null>),
    )
    rows.push(...batch.filter((row): row is WantedArtist => Boolean(row?.mbid && row.name)))
  }
  const now = Date.now()
  const stale = rows.filter((row) => now - Date.parse(row.at) > WANTED_MAX_AGE_MS)
  await Promise.all(stale.map((row) => clearWanted(row.mbid, row.decade)))
  return rows
    .filter((row) => now - Date.parse(row.at) <= WANTED_MAX_AGE_MS)
    .sort((a, b) => b.asks - a.asks || a.at.localeCompare(b.at))
    .slice(0, limit)
}
