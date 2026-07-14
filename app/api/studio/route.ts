import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { readQueue } from '@/lib/curation/followStore'
import roster from '@/lib/discover/roster.json'

/**
 * Studio bootstrap: verifies the owner key and returns everything the
 * studio page needs in one call. The roster (with tiers) comes from the
 * build-time snapshot, so it reflects the currently deployed content —
 * a just-committed retier shows up after the auto-deploy lands.
 */
export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()

  const response = NextResponse.json({
    queue: await readQueue(),
    roster: roster.map((artist) => ({
      slug: artist.slug,
      name: artist.name,
      tier: artist.tier,
    })),
    retierConfigured: Boolean(process.env.GITHUB_CONTENT_TOKEN),
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
