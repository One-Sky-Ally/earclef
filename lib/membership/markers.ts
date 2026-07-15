/**
 * Small one-shot markers in a dedicated "auth" Blobs store: one-time
 * consumption of magic-link tokens and shared-instance send throttles.
 * Kept out of the "members" store so record sweeps never see them.
 * Dev fallback mirrors the other stores.
 */
import { getStore } from '@netlify/blobs'

let devMarkers = new Map<string, number>()

function store() {
  return getStore({ name: 'auth', consistency: 'strong' })
}

/**
 * Atomically claims a key. True exactly once — concurrent and later
 * callers get false. Used to make magic links single-use.
 */
export async function claimOnce(markerKey: string): Promise<boolean> {
  try {
    const result = await store().setJSON(
      markerKey,
      { at: new Date().toISOString() },
      { onlyIfNew: true },
    )
    return Boolean(result.modified)
  } catch {
    if (devMarkers.has(markerKey)) return false
    devMarkers = new Map(devMarkers).set(markerKey, Date.now())
    return true
  }
}

/**
 * Shared cooldown gate: true when the action may proceed, false while
 * the window from the previous hit is still open. Last-writer races are
 * acceptable here — this is cost control, not access control.
 */
export async function throttleGate(
  markerKey: string,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now()
  try {
    const entry = (await store().get(markerKey, { type: 'json' })) as {
      at?: number
    } | null
    if (entry?.at && now - entry.at < windowMs) return false
    await store().setJSON(markerKey, { at: now })
    return true
  } catch {
    const last = devMarkers.get(markerKey)
    if (last && now - last < windowMs) return false
    devMarkers = new Map(devMarkers).set(markerKey, now)
    return true
  }
}
