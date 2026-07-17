/**
 * First-fan numbers: each artist has a permanent registry of everyone
 * who has ever followed them — fan #1, #2, #3… with the date. Entries
 * are NEVER removed: unfollowing and refollowing returns your original
 * number (being early is unrepeatable, so the record is permanent).
 *
 * Assignment is a compare-and-set loop on the registry blob so two
 * simultaneous first follows can't both become fan #7.
 */
import { getStore } from '@netlify/blobs'
import { normalizeEmail } from '../membership/types'

export interface FollowStamp {
  number: number
  /** ISO date of the FIRST follow, ever. */
  since: string
}

interface Registry {
  counter: number
  fans: Record<string, FollowStamp>
}

const WRITE_ATTEMPTS = 4

let devRegistries = new Map<string, Registry>()

function store() {
  return getStore({ name: 'fans', consistency: 'strong' })
}

const registryKey = (slug: string) => `numbers/${slug}`

async function readRegistry(
  slug: string,
): Promise<{ registry: Registry; etag: string | null; dev: boolean }> {
  try {
    const entry = await store().getWithMetadata(registryKey(slug), {
      type: 'json',
    })
    if (!entry) {
      return { registry: { counter: 0, fans: {} }, etag: null, dev: false }
    }
    return {
      registry: entry.data as Registry,
      etag: entry.etag ?? null,
      dev: false,
    }
  } catch {
    return {
      registry: devRegistries.get(slug) ?? { counter: 0, fans: {} },
      etag: null,
      dev: true,
    }
  }
}

/**
 * Returns the fan's permanent stamp for this artist, assigning the next
 * number on their very first follow. Idempotent forever after.
 */
export async function ensureFollowNumber(
  slug: string,
  email: string,
): Promise<FollowStamp | null> {
  const fanKey = normalizeEmail(email)

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const { registry, etag, dev } = await readRegistry(slug)
    const existing = registry.fans[fanKey]
    if (existing) return existing

    const stamp: FollowStamp = {
      number: registry.counter + 1,
      since: new Date().toISOString().slice(0, 10),
    }
    const next: Registry = {
      counter: stamp.number,
      fans: { ...registry.fans, [fanKey]: stamp },
    }

    if (dev) {
      devRegistries = new Map(devRegistries).set(slug, next)
      return stamp
    }
    try {
      const result = await store().setJSON(
        registryKey(slug),
        next,
        etag ? { onlyIfMatch: etag } : { onlyIfNew: true },
      )
      if (result.modified) return stamp
      // Lost the race — re-read; the winner may even have been us-adjacent.
    } catch {
      return null
    }
  }
  return null
}

/** The fan's stamps across the artists they follow (parallel reads). */
export async function getFollowStamps(
  email: string,
  slugs: string[],
): Promise<Record<string, FollowStamp>> {
  const fanKey = normalizeEmail(email)
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const { registry } = await readRegistry(slug)
      return [slug, registry.fans[fanKey] ?? null] as const
    }),
  )
  return Object.fromEntries(
    entries.filter(([, stamp]) => stamp !== null),
  ) as Record<string, FollowStamp>
}
