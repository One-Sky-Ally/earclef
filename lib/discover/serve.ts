/**
 * Read-side helpers shared by the Discover routes (shared pool and the
 * owner's own pool).
 */
import type { DiscoverPick, DiscoverPool } from './generate'

/**
 * Pools written before the verified-play change carry search-URL
 * listenHrefs and unverified knownFor titles; legacy picks lack `read`.
 * Strip both at the door (read-about links only) — stored output
 * outlives the generator that wrote it.
 */
export function sanitizePool(pool: DiscoverPool): DiscoverPool {
  return {
    ...pool,
    picks: pool.picks.map((pick): DiscoverPick => {
      if (pick.read) return pick
      const mbUrl = `https://musicbrainz.org/artist/${pick.mbid}`
      return {
        name: pick.name,
        why: pick.why,
        knownFor: pick.knownFor,
        knownForVerified: false,
        mbid: pick.mbid,
        play: null,
        read: { kind: 'musicbrainz', url: mbUrl },
        listenHref: mbUrl,
        song: null,
        bandcamp: null,
      }
    }),
  }
}

/** Dev-only pool fixture: verify rendering with zero model calls. */
export async function readFixture(path: string | undefined): Promise<DiscoverPool | null> {
  if (!path || process.env.NETLIFY === 'true') return null
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(path, 'utf8')) as DiscoverPool
  } catch (error) {
    console.error('Discover fixture unreadable:', error)
    return null
  }
}
