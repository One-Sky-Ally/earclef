/**
 * Member records in Netlify Blobs ("members" store, one JSON per
 * artist+email). Local dev without a Blobs context falls back to an
 * in-process map so the whole loop is testable — same pattern as the
 * curation follow store.
 */
import { getStore } from '@netlify/blobs'
import { normalizeEmail, type MemberRecord } from './types'

let devRecords = new Map<string, MemberRecord>()

function store() {
  return getStore({ name: 'members', consistency: 'strong' })
}

function key(artistSlug: string, email: string): string {
  return `${artistSlug}/${normalizeEmail(email)}`
}

export async function getMember(
  artistSlug: string,
  email: string,
): Promise<MemberRecord | null> {
  try {
    return ((await store().get(key(artistSlug, email), { type: 'json' })) ??
      null) as MemberRecord | null
  } catch {
    return devRecords.get(key(artistSlug, email)) ?? null
  }
}

export interface MemberSnapshot {
  record: MemberRecord | null
  /** Blob ETag for compare-and-set; null when the record does not exist. */
  etag: string | null
  /** True when Blobs is unreachable and the dev fallback answered. */
  dev: boolean
}

/** Read a record together with its ETag, for guarded writes. */
export async function getMemberSnapshot(
  artistSlug: string,
  email: string,
): Promise<MemberSnapshot> {
  try {
    const entry = await store().getWithMetadata(key(artistSlug, email), {
      type: 'json',
    })
    if (!entry) return { record: null, etag: null, dev: false }
    return {
      record: entry.data as MemberRecord,
      etag: entry.etag ?? null,
      dev: false,
    }
  } catch {
    return {
      record: devRecords.get(key(artistSlug, email)) ?? null,
      etag: null,
      dev: true,
    }
  }
}

/**
 * Compare-and-set write: succeeds only if the record is still at the
 * snapshot's version (or still absent). Payment recording goes through
 * this so concurrent claim/webhook deliveries can never stack years —
 * the loser re-reads and sees the session id already applied.
 */
export async function putMemberGuarded(
  record: MemberRecord,
  snapshot: MemberSnapshot,
): Promise<boolean> {
  const recordKey = key(record.artistSlug, record.email)
  if (snapshot.dev) {
    devRecords = new Map(devRecords).set(recordKey, record)
    return true
  }
  try {
    const result = await store().setJSON(
      recordKey,
      record,
      snapshot.etag ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true },
    )
    return Boolean(result.modified)
  } catch {
    // Store reachable at read time but not at write time — do not treat
    // as success; the caller retries or fails closed.
    return false
  }
}

export async function putMember(record: MemberRecord): Promise<void> {
  const recordKey = key(record.artistSlug, record.email)
  try {
    await store().setJSON(recordKey, record)
  } catch {
    devRecords = new Map(devRecords).set(recordKey, record)
  }
}

export async function deleteMember(
  artistSlug: string,
  email: string,
): Promise<void> {
  try {
    await store().delete(key(artistSlug, email))
  } catch {
    const next = new Map(devRecords)
    next.delete(key(artistSlug, email))
    devRecords = next
  }
}

/** Every record for one artist (studio member list). */
export async function listMembers(
  artistSlug: string,
): Promise<MemberRecord[]> {
  try {
    const listing = await store().list({ prefix: `${artistSlug}/` })
    const records = await Promise.all(
      listing.blobs.map(
        (blob) =>
          store().get(blob.key, { type: 'json' }) as Promise<MemberRecord>,
      ),
    )
    return records.filter(Boolean)
  } catch {
    return [...devRecords.values()].filter(
      (record) => record.artistSlug === artistSlug,
    )
  }
}

/** Every record across all artists (reminder sweep). */
export async function listAllMembers(): Promise<MemberRecord[]> {
  try {
    const listing = await store().list()
    const records = await Promise.all(
      listing.blobs.map(
        (blob) =>
          store().get(blob.key, { type: 'json' }) as Promise<MemberRecord>,
      ),
    )
    return records.filter(Boolean)
  } catch {
    return [...devRecords.values()]
  }
}
