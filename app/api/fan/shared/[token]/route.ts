import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { getFollowStamps } from '@/lib/fans/followNumbers'
import { getFanByShareToken } from '@/lib/fans/store'
import { followTiers } from '@/lib/tiers'
import { mbidOfKey, pagelessView, promoteRostered } from '@/lib/fans/artistKeys'
import { rosterSlugByMbid } from '@/lib/fans/rosterIndex'

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

  // As it stands today: a followed artist who has a page by now is the
  // page's follow (read only — the fan's own visit writes it).
  const view = promoteRostered(fan, rosterSlugByMbid())
  const stamps = await getFollowStamps(
    fan.email,
    view.follows.filter((key) => !mbidOfKey(key)),
  )
  const tiers = followTiers(view.follows, view.tiers)
  // Artists with no page yet (Nov 28 2026) open on their archive card.
  const pageless = pagelessView(view.follows, view.artistNames)
  const artists = view.follows.flatMap((slug) => {
    const content = getArtistBySlug(slug)
    const archive = pageless[slug]
    if (!content && !archive) return []
    return [
      {
        slug,
        name: content ? content.hero.name : archive.name,
        tier: tiers[slug],
        stamp: stamps[slug] ?? null,
        href: content ? `/${slug}` : `/a/${archive.mbid}`,
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
