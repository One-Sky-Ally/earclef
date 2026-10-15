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
import { followTiers, isArtistTier, type ArtistTier } from '../tiers'
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
  /**
   * slug → the fan's own tier for that artist. A follow with no entry
   * reads as the default tier (followTiers) — never stored, so records
   * from before tiers were chosen at follow time need no migration.
   */
  tiers?: Record<string, ArtistTier>
  /**
   * Songs the fan liked while a queue was playing, newest first. The
   * artists behind them are what the taste map's radar tier derives
   * from — the tier is never stored, only computed from these.
   */
  likes?: LikedTrack[]
  /**
   * MusicBrainz ids the fan has taken off the derived radar tier. The
   * radar itself is never stored — only these removals are.
   */
  radarDismissed?: string[]
  /** Preferred streaming service — follows the fan across devices. */
  listenService?: string
  /** Present while sharing is on; the public page lives at /fan/<token>. */
  shareToken?: string
  /** Shown on the share page instead of anything email-derived. */
  displayName?: string
  /** When the owner moved the site's rotation groups into this account. */
  siteTiersClaimedAt?: string
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
    radarDismissed: existing?.radarDismissed,
    listenService: existing?.listenService,
    shareToken: existing?.shareToken,
    displayName: existing?.displayName,
    siteTiersClaimedAt: existing?.siteTiersClaimedAt,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
}

export interface FollowState {
  follows: string[]
  /** Every follow's tier, defaults filled in (followTiers). */
  tiers: Record<string, ArtistTier>
}

/**
 * Adds or removes a follow. A follow can carry the tier the fan picked
 * for it; without one it keeps whatever tier it already had (or the
 * default). Unfollowing clears the tier — it only means something on a
 * follow.
 */
export async function setFollow(
  email: string,
  slug: string,
  following: boolean,
  tier?: ArtistTier,
): Promise<FollowState> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const current = existing?.follows ?? []
  const next = following
    ? [...new Set([...current, slug])].slice(0, MAX_FOLLOWS)
    : current.filter((followed) => followed !== slug)

  const record = baseRecord(normalized, existing)
  record.follows = next
  if (following && tier && isArtistTier(tier) && next.includes(slug)) {
    record.tiers = { ...record.tiers, [slug]: tier }
  } else if (!following && record.tiers?.[slug]) {
    const { [slug]: _dropped, ...rest } = record.tiers
    record.tiers = rest
  }
  await putFan(record)
  return { follows: next, tiers: followTiers(next, record.tiers) }
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
 * Sets the fan's tier for a followed artist (null puts it back on the
 * default). Returns every follow's tier, or null when the slug isn't
 * followed.
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
  return followTiers(record.follows, record.tiers)
}

export interface ClaimResult {
  /** Artists the account did not follow before — followed now. */
  added: number
  /** Follows that took the site's tier (new, or never placed by the fan). */
  placed: Record<ArtistTier, number>
  /** Slugs where the fan had already chosen a tier — theirs was kept. */
  kept: string[]
  claimedAt: string
}

/**
 * Moves the owner's original rotation groups (content JSON) into their
 * own fan account, so nothing is lost now that visitors no longer see
 * them. Additive and safe to repeat: existing follows stay, a tier the
 * fan already chose is never overwritten, and fan numbers are not minted
 * — those record someone pressing Follow, which this is not.
 */
export async function claimSiteTiers(
  email: string,
  siteTiers: { slug: string; tier: ArtistTier }[],
): Promise<ClaimResult> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const record = baseRecord(normalized, existing)
  const follows = new Set(record.follows)
  const tiers: Record<string, ArtistTier> = { ...record.tiers }
  const placed: Record<ArtistTier, number> = {
    'heavy-rotation': 0,
    'in-the-mix': 0,
    'on-the-radar': 0,
  }
  const kept: string[] = []
  let added = 0

  for (const { slug, tier } of siteTiers) {
    if (!isArtistTier(tier)) continue
    if (!follows.has(slug)) {
      if (follows.size >= MAX_FOLLOWS) continue
      follows.add(slug)
      added++
    }
    if (isArtistTier(tiers[slug])) {
      if (tiers[slug] !== tier) kept.push(slug)
      continue
    }
    tiers[slug] = tier
    placed[tier]++
  }

  record.follows = [...follows]
  record.tiers = tiers
  record.siteTiersClaimedAt = new Date().toISOString()
  await putFan(record)
  return { added, placed, kept, claimedAt: record.siteTiersClaimedAt }
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

/**
 * Takes an artist off the derived radar, or puts them back. Dismissals
 * are the ONLY radar state — the tier itself is recomputed from the
 * likes on every render.
 */
export async function setRadarDismissed(
  email: string,
  mbid: string,
  dismissed: boolean,
): Promise<string[]> {
  const normalized = normalizeEmail(email)
  const existing = await getFan(normalized)
  const current = existing?.radarDismissed ?? []
  const next = dismissed
    ? [...new Set([...current, mbid])]
    : current.filter((entry) => entry !== mbid)
  if (next.length === current.length && dismissed) return current

  const record = baseRecord(normalized, existing)
  record.radarDismissed = next
  await putFan(record)
  return next
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
