import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { setOwnerAccount } from '@/lib/curation/ownerAccount'
import { sessionEmail } from '@/lib/membership/session'

/**
 * Links the fan account signed in on this browser as the owner's: the
 * owner's own Discover picks then follow that account's rows. Needs the
 * owner key AND the session, like the rotation-group copy.
 */
export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()
  const email = sessionEmail(request)
  if (!email) {
    return NextResponse.json(
      { error: 'Sign in on /me first — the picks follow that account.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  await setOwnerAccount(email)
  return NextResponse.json(
    { ok: true, email },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
