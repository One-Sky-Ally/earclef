import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import {
  ensureFollowNumber,
  getFollowStamps,
} from '@/lib/fans/followNumbers'
import {
  MAX_LIKES,
  isVideoId,
  sanitizeLikedTrack,
  type LikedTrack,
} from '@/lib/fans/likes'
import { mbidOfKey, pagelessView, sanitizePageless } from '@/lib/fans/artistKeys'
import { rosterSlugByMbid } from '@/lib/fans/rosterIndex'
import {
  addLike,
  mergeLikes,
  promoteRosteredFollows,
  removeLike,
  setFollow,
  setListenService,
  setRadarDismissed,
  setPersonalTier,
  setShare,
} from '@/lib/fans/store'
import { isListenService } from '@/lib/listen/services'
import { sessionEmail } from '@/lib/membership/session'
import { followTiers, isArtistTier } from '@/lib/tiers'

/**
 * The fan profile: who the session cookie belongs to, which artists
 * they follow, their personal tiers, the songs they liked, and the
 * share state. GET reads; POST changes exactly one thing per call
 * (follow — optionally with the tier picked for it — tier, service,
 * share, or a like). Signed-out visitors get an
 * honest {signedIn: false} — the UI offers magic-link sign-in, and
 * likes made while signed out live in the browser until it happens.
 */

const MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request) {
  const email = sessionEmail(request)
  if (!email) return noStore({ signedIn: false, follows: [], likes: [] })
  // A page-less follow whose artist now has a page is read as the page's.
  const fan = await promoteRosteredFollows(email, rosterSlugByMbid())
  const follows = fan?.follows ?? []
  return noStore({
    signedIn: true,
    email,
    follows,
    // Every follow's tier, defaults filled in: a follow the fan never
    // placed reads as "In the mix" (owner, Oct 14 2026).
    tiers: followTiers(follows, fan?.tiers),
    // Followed artists with no page yet (`mb:` keys): who they are.
    artists: pagelessView(follows, fan?.artistNames),
    likes: fan?.likes ?? [],
    radarDismissed: fan?.radarDismissed ?? [],
    stamps: await getFollowStamps(email, rosterKeys(follows)),
    listenService: fan?.listenService,
    share: {
      enabled: Boolean(fan?.shareToken),
      token: fan?.shareToken,
      displayName: fan?.displayName,
    },
  })
}

/** Fan numbers belong to roster pages: page-less follows have none. */
const rosterKeys = (follows: readonly string[]) => follows.filter((key) => !mbidOfKey(key))

interface FanPostBody {
  /** A roster slug, or `mb:<MusicBrainz id>` for an artist with no page yet. */
  slug?: string
  /** For an `mb:` follow: the artist's name and a video for the card — validated, never trusted. */
  artist?: unknown
  following?: boolean
  tier?: string | null
  listenService?: string
  share?: { enabled?: boolean; displayName?: string }
  /** A song to save, in the LikedTrack shape — validated, never trusted. */
  like?: unknown
  /** Video id of a saved song to drop. */
  unlike?: string
  /** Likes made before signing in, handed over on the merge. */
  mergeLikes?: unknown
  /** Take an artist off the derived radar tier, or put them back. */
  radar?: { mbid?: string; dismissed?: boolean }
}

export async function POST(request: Request) {
  const email = sessionEmail(request)
  if (!email) {
    return noStore({ error: 'Sign in to save preferences' }, 401)
  }

  let body: FanPostBody
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }

  if (body.listenService !== undefined) {
    if (!isListenService(body.listenService)) {
      return noStore({ error: 'Unknown service' }, 400)
    }
    await setListenService(email, body.listenService)
    return noStore({ signedIn: true, listenService: body.listenService })
  }

  if (body.share !== undefined) {
    const share = await setShare(
      email,
      body.share.enabled !== false,
      body.share.displayName,
    )
    return noStore({ signedIn: true, share })
  }

  // Likes come BEFORE the roster check on purpose: most of what a
  // listener saves out of a place-and-era queue is an artist the site
  // has no page for, and that is the point of the feature.
  if (body.like !== undefined) {
    const track = sanitizeLikedTrack(body.like)
    if (!track) {
      return noStore(
        { error: 'A like needs a playable video, a title and an artist' },
        400,
      )
    }
    const result = await addLike(email, track)
    return noStore({ signedIn: true, ...result })
  }

  if (body.unlike !== undefined) {
    if (!isVideoId(body.unlike)) {
      return noStore({ error: 'Unknown video' }, 400)
    }
    return noStore({ signedIn: true, ...(await removeLike(email, body.unlike)) })
  }

  if (body.mergeLikes !== undefined) {
    if (!Array.isArray(body.mergeLikes)) {
      return noStore({ error: 'Likes must be a list' }, 400)
    }
    const now = Date.now()
    // Bounded before any work: an oversized payload is capped, not
    // trusted. Anything past the cap is a like that did not fit, which
    // is what `skipped` already means to the caller.
    const considered = body.mergeLikes.slice(0, MAX_LIKES)
    const overflow = body.mergeLikes.length - considered.length
    const tracks = considered
      .map((entry) => sanitizeLikedTrack(entry, now))
      .filter((track): track is LikedTrack => track !== null)
    const rejected = considered.length - tracks.length
    const result = await mergeLikes(email, tracks)
    return noStore({
      signedIn: true,
      ...result,
      skipped: result.skipped + overflow,
      rejected,
    })
  }

  if (body.radar !== undefined) {
    const mbid = String(body.radar.mbid ?? '').toLowerCase()
    if (!MBID_PATTERN.test(mbid)) {
      return noStore({ error: 'Unknown artist id' }, 400)
    }
    const radarDismissed = await setRadarDismissed(
      email,
      mbid,
      body.radar.dismissed !== false,
    )
    return noStore({ signedIn: true, radarDismissed })
  }

  // An `mb:` key is an artist with no page — unless they have one now.
  const slugByMbid = rosterSlugByMbid()
  const requested = String(body.slug ?? '')
  const pagelessMbid = mbidOfKey(requested.toLowerCase())
  const slug = pagelessMbid ? (slugByMbid[pagelessMbid] ?? `mb:${pagelessMbid}`) : requested
  const pageless = mbidOfKey(slug) !== null
  if (!pageless && !getArtistBySlug(slug)) {
    return noStore({ error: 'Unknown artist' }, 404)
  }
  const current = await promoteRosteredFollows(email, slugByMbid)

  // A tier change on its own (no `following` key) re-files a follow.
  if (body.tier !== undefined && body.following === undefined) {
    if (body.tier !== null && !isArtistTier(body.tier)) {
      return noStore({ error: 'Unknown tier' }, 400)
    }
    const tiers = await setPersonalTier(email, slug, body.tier)
    if (tiers === null) {
      return noStore({ error: 'Tier an artist you follow' }, 400)
    }
    return noStore({ signedIn: true, tiers })
  }

  const following = body.following !== false
  // A follow may carry the tier the fan picked for it.
  if (following && body.tier != null && !isArtistTier(body.tier)) {
    return noStore({ error: 'Unknown tier' }, 400)
  }
  const artist = pageless ? sanitizePageless(body.artist) : null
  if (pageless && following && !artist && !current?.artistNames?.[slug]) {
    return noStore({ error: 'A follow needs the artist’s name' }, 400)
  }
  const { follows, tiers, artistNames } = await setFollow(
    email,
    slug,
    following,
    isArtistTier(body.tier) ? body.tier : undefined,
    artist ?? undefined,
  )
  // First follow mints a permanent number; refollows return the original.
  // Numbers belong to roster pages.
  if (following && !pageless) await ensureFollowNumber(slug, email)
  return noStore({
    signedIn: true,
    email,
    follows,
    tiers,
    artists: pagelessView(follows, artistNames),
    stamps: await getFollowStamps(email, rosterKeys(follows)),
  })
}
