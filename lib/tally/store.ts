/**
 * Server side of the anonymous counts (lib/tally/counts.ts): one Blobs
 * entry per day holding plain totals. Adding is a compare-and-set loop
 * so two visitors pressing play at once both land. What is stored is
 * the totals and nothing else — the request that brought a count is
 * never written down.
 */
import { getStore } from '@netlify/blobs'
import {
  addOne,
  dayKey,
  recentDays,
  type DayTotals,
  type TallyKind,
  type TallySection,
} from './counts'

const WRITE_ATTEMPTS = 6

const devState = globalThis as unknown as { __earclefDevTally?: Map<string, DayTotals> }
// Local dev has no Blobs: counts live in memory until the server restarts.
const devDays = (devState.__earclefDevTally ??= new Map())

function store() {
  return getStore({ name: 'tally', consistency: 'strong' })
}

const blobKey = (day: string) => `days/${day}`

export async function addCount(kind: TallyKind, section: TallySection): Promise<boolean> {
  const day = dayKey(new Date())
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    let current: DayTotals = {}
    let etag: string | null = null
    try {
      const entry = await store().getWithMetadata(blobKey(day), { type: 'json' })
      if (entry) {
        current = entry.data as DayTotals
        etag = entry.etag ?? null
      }
    } catch {
      devDays.set(day, addOne(devDays.get(day) ?? {}, kind, section))
      return true
    }
    try {
      const result = await store().setJSON(
        blobKey(day),
        addOne(current, kind, section),
        etag ? { onlyIfMatch: etag } : { onlyIfNew: true },
      )
      if (result.modified) return true
      // Someone else's count landed first: read again and add on top.
    } catch {
      return false
    }
  }
  return false
}

/** The last `count` days' totals, newest first (a day nobody visited is {}). */
export async function readRecentDays(
  count: number,
): Promise<{ day: string; totals: DayTotals }[]> {
  const days = recentDays(new Date(), count)
  return Promise.all(
    days.map(async (day) => {
      try {
        const totals = (await store().get(blobKey(day), { type: 'json' })) as DayTotals | null
        return { day, totals: totals ?? {} }
      } catch {
        return { day, totals: devDays.get(day) ?? {} }
      }
    }),
  )
}
