import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { getFollowStamps } from '@/lib/fans/followNumbers'
import { getFanByShareToken } from '@/lib/fans/store'

/**
 * A shared taste map, by unguessable token. Public and read-only:
 * display name (never the email), follows with personal tiers, and
 * first-fan stamps. no-store so turning sharing off kills the page on
 * the very next request.
 */

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  const fan = await getFanByShareToken(token)
  if (!fan) {
    const miss = NextResponse.json(
      { error: 'This taste map is private or the link has been retired' },
      { status: 404 },
    )
    miss.headers.set('Cache-Control', 'no-store')
    return miss
  }

  const stamps = await getFollowStamps(fan.email, fan.follows)
  const artists = fan.follows.flatMap((slug) => {
    const content = getArtistBySlug(slug)
    if (!content) return []
    return [
      {
        slug,
        name: content.hero.name,
        tier: fan.tiers?.[slug] ?? null,
        stamp: stamps[slug] ?? null,
      },
    ]
  })

  const response = NextResponse.json({
    displayName: fan.displayName ?? null,
    since: fan.createdAt.slice(0, 10),
    artists,
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
