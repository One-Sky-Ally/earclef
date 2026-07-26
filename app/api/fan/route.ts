import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import {
  ensureFollowNumber,
  getFollowStamps,
} from '@/lib/fans/followNumbers'
import {
  getFan,
  setFollow,
  setListenService,
  setPersonalTier,
  setShare,
} from '@/lib/fans/store'
import { isListenService } from '@/lib/listen/services'
import { sessionEmail } from '@/lib/membership/session'
import { isArtistTier } from '@/lib/tiers'

/**
 * The fan profile: who the session cookie belongs to, which artists
 * they follow, their personal tiers, and the share state. GET reads;
 * POST changes exactly one thing per call (follow, tier, service, or
 * share). Signed-out visitors get an honest {signedIn: false} — the UI
 * offers magic-link sign-in.
 */

function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request) {
  const email = sessionEmail(request)
  if (!email) return noStore({ signedIn: false, follows: [] })
  const fan = await getFan(email)
  const follows = fan?.follows ?? []
  return noStore({
    signedIn: true,
    email,
    follows,
    tiers: fan?.tiers ?? {},
    stamps: await getFollowStamps(email, follows),
    listenService: fan?.listenService,
    share: {
      enabled: Boolean(fan?.shareToken),
      token: fan?.shareToken,
      displayName: fan?.displayName,
    },
  })
}

interface FanPostBody {
  slug?: string
  following?: boolean
  tier?: string | null
  listenService?: string
  share?: { enabled?: boolean; displayName?: string }
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

  const slug = body.slug ?? ''
  if (!getArtistBySlug(slug)) {
    return noStore({ error: 'Unknown artist' }, 404)
  }

  if (body.tier !== undefined) {
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
  const follows = await setFollow(email, slug, following)
  // First follow mints a permanent number; refollows return the original.
  if (following) await ensureFollowNumber(slug, email)
  return noStore({
    signedIn: true,
    email,
    follows,
    stamps: await getFollowStamps(email, follows),
  })
}
