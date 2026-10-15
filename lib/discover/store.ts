/**
 * The pools the retired nightly Discover job left in Netlify Blobs
 * (`pool-<date>`, `latest-date`). Nothing writes them any more — Discover
 * is stocked during /refresh-earclef (./stockStore) — but the latest one
 * keeps the row filled, labelled as from the archive, until the first
 * stocked set exists, so the switchover never shows an empty row.
 */
import { getStore } from '@netlify/blobs'
import type { DiscoverPool } from './types'

function store() {
  return getStore({ name: 'discover', consistency: 'strong' })
}

/** The most recent pool the nightly job wrote, or null (dev: none). */
export async function readLatestLegacyPool(): Promise<DiscoverPool | null> {
  try {
    const s = store()
    const latestDate = (await s.get('latest-date', { type: 'text' })) as string | null
    if (!latestDate) return null
    return (await s.get(`pool-${latestDate}`, { type: 'json' })) as DiscoverPool | null
  } catch {
    return null
  }
}
