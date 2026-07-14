/**
 * Stage 2 — the subscription skeleton. A membership is a PAID YEAR, not a
 * subscription object: there is no auto-renewal anywhere in this model
 * (the No-Inertia Principle). Records simply expire; renewing is a fresh,
 * deliberate payment that extends from the current expiry.
 */

export interface MemberRecord {
  email: string
  artistSlug: string
  /** ISO datetime of the first join. */
  startedAt: string
  /** ISO datetime the membership lapses — checked at request time. */
  expiresAt: string
  /** How the current year was granted. */
  source: 'stripe' | 'comp'
  /** Stripe Checkout session id of the most recent payment. */
  stripeSessionId?: string
  /** Count of years beyond the first. */
  renewals: number
  /** ISO datetime the ~2-weeks-out reminder went out (once per year). */
  remindedAt?: string
  /** ISO datetime the gentle post-expiry note went out (once). */
  followupAt?: string
}

export type UniversePostKind = 'text' | 'image' | 'audio'

export interface UniverseMedia {
  /** Blob key segment under `<slug>/media/<id>`. */
  id: string
  contentType: string
  filename: string
  /** Seconds — audio only, so the player renders without preloading. */
  duration?: number
}

export interface UniversePost {
  id: string
  /** ISO date the post was published. */
  createdAt: string
  kind: UniversePostKind
  title: string
  /** Body text (text posts) or caption (media posts). */
  body?: string
  media?: UniverseMedia
  /** Image alt text. */
  alt?: string
}

/** What non-members see: enough to want in, nothing of the content. */
export interface UniverseTeaser {
  id: string
  createdAt: string
  kind: UniversePostKind
  title: string
}

export function toTeaser(post: UniversePost): UniverseTeaser {
  return {
    id: post.id,
    createdAt: post.createdAt,
    kind: post.kind,
    title: post.title,
  }
}

/** /api/universe/[slug] for visitors and signed-in non-members. */
export interface UniverseLockedResponse {
  locked: true
  signedInAs?: string
  teasers: UniverseTeaser[]
  checkoutReady: boolean
  signInReady: boolean
}

/** /api/universe/[slug] for active members. */
export interface UniverseMemberResponse {
  locked: false
  member: { email: string; expiresAt: string; source: 'stripe' | 'comp' }
  posts: UniversePost[]
}

export type UniverseResponse = UniverseLockedResponse | UniverseMemberResponse

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * A paid or comped year extends from the CURRENT expiry when it is still
 * in the future — renewing early never costs days.
 */
export function extendMembership(
  existing: MemberRecord | null,
  args: {
    email: string
    artistSlug: string
    source: MemberRecord['source']
    stripeSessionId?: string
    now?: Date
  },
): MemberRecord {
  const now = args.now ?? new Date()
  const base =
    existing && new Date(existing.expiresAt) > now
      ? new Date(existing.expiresAt)
      : now
  return {
    email: args.email,
    artistSlug: args.artistSlug,
    startedAt: existing?.startedAt ?? now.toISOString(),
    expiresAt: new Date(base.getTime() + YEAR_MS).toISOString(),
    source: args.source,
    stripeSessionId: args.stripeSessionId ?? existing?.stripeSessionId,
    renewals: existing ? existing.renewals + 1 : 0,
  }
}

export function isActive(record: MemberRecord | null, now = new Date()): boolean {
  return Boolean(record && new Date(record.expiresAt) > now)
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
