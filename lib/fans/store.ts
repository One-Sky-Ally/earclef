/**
 * Fan profiles — the lightest viable identity: an email (the same
 * magic-link session the membership uses) plus the slugs they follow.
 * No password, no profile, nothing else. Blobs "fans" store, one record
 * per email; dev fallback mirrors the other stores.
 */
import { getStore } from '@netlify/blobs'
import { normalizeEmail } from '../membership/types'

export interface FanRecord {
  email: string
  follows: string[]
  /** Preferred streaming service — follows the fan across devices. */
  listenService?: string
  createdAt: string
}

const MAX_FOLLOWS = 200

let devFans = new Map<string, FanRecord>()

function store() {
  return getStore({ name: 'fans', consistency: 'strong' })
}

export async function getFan(email: string): Promise<FanRecord | null> {
  const key = normalizeEmail(email)
  try {
    return ((await store().get(key, { type: 'json' })) ??
      null) as FanRecord | null
  } catch {
    return devFans.get(key) ?? null
  }
}

async function putFan(record: FanRecord): Promise<void> {
  const key = normalizeEmail(record.email)
  try {
    await store().setJSON(key, record)
  } catch {
    devFans = new Map(devFans).set(key, record)
  }
}

/** Adds or removes a follow; returns the updated follow list. */
export async function setFollow(
  email: string,
  slug: string,
  following: boolean,
): Promise<string[]> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const current = existing?.follows ?? []
  const next = following
    ? [...new Set([...current, slug])].slice(0, MAX_FOLLOWS)
    : current.filter((followed) => followed !== slug)

  await putFan({
    email: normalized,
    follows: next,
    listenService: existing?.listenService,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  })
  return next
}

/** Persists the fan's preferred streaming service. */
export async function setListenService(
  email: string,
  listenService: string,
): Promise<void> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  await putFan({
    email: normalized,
    follows: existing?.follows ?? [],
    listenService,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  })
}
