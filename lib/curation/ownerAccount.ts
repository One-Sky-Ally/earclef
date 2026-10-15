/**
 * Which fan account is the owner's: recorded when the owner copies the
 * site's rotation groups into an account (or links one) from the Studio,
 * where both the owner key and that account's session are present. The
 * owner's own Discover picks follow that account's rows. Blobs
 * "curation" store; dev falls back to process memory.
 */
import { getStore } from '@netlify/blobs'

const KEY = 'owner-account'

const devState = globalThis as unknown as { __earclefDevOwnerAccount?: string | null }

function store() {
  return getStore({ name: 'curation', consistency: 'strong' })
}

export async function getOwnerAccount(): Promise<string | null> {
  try {
    const entry = (await store().get(KEY, { type: 'json' })) as { email?: string } | null
    return entry?.email ?? null
  } catch {
    return devState.__earclefDevOwnerAccount ?? null
  }
}

export async function setOwnerAccount(email: string): Promise<void> {
  try {
    await store().setJSON(KEY, { email, linkedAt: new Date().toISOString() })
  } catch {
    devState.__earclefDevOwnerAccount = email
  }
}
