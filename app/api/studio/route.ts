import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { readQueue } from '@/lib/curation/followStore'
import roster from '@/lib/discover/roster.json'
import { getFan } from '@/lib/fans/store'
import { sessionEmail } from '@/lib/membership/session'

/**
 * Studio bootstrap: verifies the owner key and returns everything the
 * studio page needs in one call. The roster (with tiers) comes from the
 * build-time snapshot, so it reflects the currently deployed content —
 * a just-committed retier shows up after the auto-deploy lands.
 */
export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()

  // The fan account signed in on this browser, if any — where the
  // "move my rotation groups" button would put them.
  const email = sessionEmail(request)
  const fan = email ? await getFan(email) : null

  const response = NextResponse.json({
    queue: await readQueue(),
    roster: roster.map((artist) => ({
      slug: artist.slug,
      name: artist.name,
      tier: artist.tier,
      membership: artist.membership,
    })),
    retierConfigured: Boolean(process.env.GITHUB_CONTENT_TOKEN),
    account: email
      ? {
          email,
          follows: fan?.follows.length ?? 0,
          claimedAt: fan?.siteTiersClaimedAt ?? null,
        }
      : null,
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
