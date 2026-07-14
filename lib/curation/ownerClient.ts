/**
 * Client-side owner-mode helpers. The key in localStorage only decides
 * which UI renders — every write is re-validated server-side against
 * OWNER_KEY, so a forged localStorage entry buys nothing.
 */

const STORAGE_KEY = 'earclef-owner-key'

export function getOwnerKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setOwnerKey(key: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Private-mode storage failures just mean owner mode won't persist.
  }
}

export function clearOwnerKey(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
