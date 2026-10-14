import { NextResponse } from 'next/server'
import { getAllArtists } from '@/lib/content'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { setOwnerAccount } from '@/lib/curation/ownerAccount'
import { claimSiteTiers } from '@/lib/fans/store'
import { sessionEmail } from '@/lib/membership/session'
import { isArtistTier } from '@/lib/tiers'

/**
 * Moves the owner's original rotation groups (the `tier` in content
 * JSON) into the fan account signed in on this browser. Needs BOTH the
 * owner key and a fan session: the key proves it is the owner asking,
 * the session says which account receives them. Additive and safe to
 * repeat — see claimSiteTiers. That account also becomes the one the
 * owner's own Discover picks follow.
 */
export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()
  const email = sessionEmail(request)
  if (!email) {
    return NextResponse.json(
      { error: 'Sign in on /me first — the groups go into that account.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const siteTiers = getAllArtists().flatMap((artist) =>
    isArtistTier(artist.tier) ? [{ slug: artist.slug, tier: artist.tier }] : [],
  )
  const result = await claimSiteTiers(email, siteTiers)
  await setOwnerAccount(email)
  return NextResponse.json(
    { ok: true, email, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
