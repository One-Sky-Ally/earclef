/**
 * Fan profiles — the lightest viable identity: an email (the same
 * magic-link session the membership uses) plus the slugs they follow,
 * their personal tiers (the fan's own taste map, same vocabulary as the
 * site tiers), and an optional share token that makes the taste map a
 * public read-only page. Blobs "fans" store, one record per email;
 * share tokens get a reverse-index key so the public page can resolve
 * them without listing fans. Dev fallback mirrors the other stores.
 */
import { randomBytes } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { isArtistTier, type ArtistTier } from '../tiers'
import { normalizeEmail } from '../membership/types'
import {
  MAX_LIKES,
  byNewestFirst,
  sameTrack,
  type LikedTrack,
} from './likes'

export interface FanRecord {
  email: string
  follows: string[]
  /** slug → the fan's own tier for that artist (untiered = plain follow). */
  tiers?: Record<string, ArtistTier>
  /**
   * Songs the fan liked while a queue was playing, newest first. The
   * artists behind them are what the taste map's radar tier derives
   * from — the tier is never stored, only computed from these.
   */
  likes?: LikedTrack[]
  /** Preferred streaming service — follows the fan across devices. */
  listenService?: string
  /** Present while sharing is on; the public page lives at /fan/<token>. */
  shareToken?: string
  /** Shown on the share page instead of anything email-derived. */
  displayName?: string
  createdAt: string
}

const MAX_FOLLOWS = 200
export const MAX_DISPLAY_NAME = 40

// Dev fallback state lives on globalThis: Next dev compiles route
// handlers and server components into separate module graphs, and a
// per-module Map would leave the /fan/[token] page blind to writes
// made through /api/fan. Production always goes through Blobs.
const devState = globalThis as unknown as {
  __earclefDevFans?: Map<string, FanRecord>
  __earclefDevShareIndex?: Map<string, string>
}
const devFans = (devState.__earclefDevFans ??= new Map())
const devShareIndex = (devState.__earclefDevShareIndex ??= new Map())

function store() {
  return getStore({ name: 'fans', consistency: 'strong' })
}

const shareKey = (token: string) => `share/${token}`

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
    devFans.set(key, record)
  }
}

function baseRecord(email: string, existing: FanRecord | null): FanRecord {
  return {
    email,
    follows: existing?.follows ?? [],
    tiers: existing?.tiers,
    likes: existing?.likes,
    listenService: existing?.listenService,
    shareToken: existing?.shareToken,
    displayName: existing?.displayName,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
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

  const record = baseRecord(normalized, existing)
  record.follows = next
  if (!following && record.tiers?.[slug]) {
    // A tier only means something on a follow; unfollowing clears it.
    const { [slug]: _dropped, ...rest } = record.tiers
    record.tiers = rest
  }
  await putFan(record)
  return next
}

/** Persists the fan's preferred streaming service. */
export async function setListenService(
  email: string,
  listenService: string,
): Promise<void> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const record = baseRecord(normalized, existing)
  record.listenService = listenService
  await putFan(record)
}

/**
 * Sets or clears the fan's personal tier for a followed artist.
 * Returns the updated tier map, or null when the slug isn't followed.
 */
export async function setPersonalTier(
  email: string,
  slug: string,
  tier: ArtistTier | null,
): Promise<Record<string, ArtistTier> | null> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  if (!existing?.follows.includes(slug)) return null

  const record = baseRecord(normalized, existing)
  const current = record.tiers ?? {}
  if (tier === null) {
    const { [slug]: _dropped, ...rest } = current
    record.tiers = rest
  } else if (isArtistTier(tier)) {
    record.tiers = { ...current, [slug]: tier }
  }
  await putFan(record)
  return record.tiers ?? {}
}

export interface LikesResult {
  likes: LikedTrack[]
  /** The save was refused because the shelf is full — nothing was dropped. */
  atCapacity?: boolean
}

/**
 * Saves a song. Liking one that is already saved changes nothing (the
 * original like keeps its timestamp and the context it was made in),
 * and a full shelf refuses the new like rather than quietly evicting an
 * old one — the listener is told, never silently overruled.
 */
export async function addLike(
  email: string,
  track: LikedTrack,
): Promise<LikesResult> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const current = existing?.likes ?? []

  if (current.some((saved) => sameTrack(saved, track))) {
    return { likes: current }
  }
  if (current.length >= MAX_LIKES) {
    return { likes: current, atCapacity: true }
  }

  const record = baseRecord(normalized, existing)
  record.likes = [track, ...current].sort(byNewestFirst)
  await putFan(record)
  return { likes: record.likes }
}

/** Removes a saved song by video id. Unknown ids are a no-op, not an error. */
export async function removeLike(
  email: string,
  videoId: string,
): Promise<LikesResult> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const current = existing?.likes ?? []
  const next = current.filter((saved) => saved.videoId !== videoId)
  if (next.length === current.length) return { likes: current }

  const record = baseRecord(normalized, existing)
  record.likes = next
  await putFan(record)
  return { likes: next }
}

export interface MergeLikesResult extends LikesResult {
  added: number
  /** Local likes that did not fit — the client keeps them and says so. */
  skipped: number
}

/**
 * Folds in likes made before signing in. Everything already saved is
 * kept: only the free space below the cap is offered to the newcomers,
 * newest first, so a merge can never evict a like the fan already has
 * on the server. Whatever does not fit is REPORTED, never dropped
 * silently.
 */
export async function mergeLikes(
  email: string,
  incoming: LikedTrack[],
): Promise<MergeLikesResult> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const current = existing?.likes ?? []

  const fresh = incoming
    .filter((track) => !current.some((saved) => sameTrack(saved, track)))
    .sort(byNewestFirst)
  const room = Math.max(0, MAX_LIKES - current.length)
  const accepted = fresh.slice(0, room)
  const skipped = fresh.length - accepted.length

  if (accepted.length === 0) {
    return { likes: current, added: 0, skipped }
  }

  const record = baseRecord(normalized, existing)
  record.likes = [...current, ...accepted].sort(byNewestFirst)
  await putFan(record)
  return { likes: record.likes, added: accepted.length, skipped }
}

function sanitizeDisplayName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_DISPLAY_NAME)
}

export interface ShareState {
  enabled: boolean
  token?: string
  displayName?: string
}

/**
 * Turns sharing on (minting a fresh unguessable token — re-enabling
 * retires any old link) or off (deleting the token and its reverse
 * index, which kills the public page instantly).
 */
export async function setShare(
  email: string,
  enabled: boolean,
  displayName?: string,
): Promise<ShareState> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const record = baseRecord(normalized, existing)
  const oldToken = record.shareToken

  if (displayName !== undefined) {
    const clean = sanitizeDisplayName(displayName)
    record.displayName = clean || undefined
  }

  if (enabled) {
    record.shareToken = randomBytes(16).toString('hex')
  } else {
    record.shareToken = undefined
  }
  await putFan(record)

  try {
    if (oldToken) await store().delete(shareKey(oldToken))
    if (record.shareToken) {
      await store().setJSON(shareKey(record.shareToken), {
        email: normalized,
      })
    }
  } catch {
    if (oldToken) devShareIndex.delete(oldToken)
    if (record.shareToken) {
      devShareIndex.set(record.shareToken, normalized)
    }
  }

  return {
    enabled: Boolean(record.shareToken),
    token: record.shareToken,
    displayName: record.displayName,
  }
}

/** Resolves a share token to the fan record — null for retired links. */
export async function getFanByShareToken(
  token: string,
): Promise<FanRecord | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  let email: string | null = null
  try {
    const entry = (await store().get(shareKey(token), {
      type: 'json',
    })) as { email?: string } | null
    email = entry?.email ?? null
  } catch {
    email = devShareIndex.get(token) ?? null
  }
  if (!email) return null
  const fan = await getFan(email)
  // The record's token must still match — a re-mint retires old links.
  return fan?.shareToken === token ? fan : null
}
