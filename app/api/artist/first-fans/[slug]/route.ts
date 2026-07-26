import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { getFirstFans } from '@/lib/fans/followNumbers'

/**
 * The first fans of an artist — ANONYMOUS by design: permanent numbers
 * and first-follow dates only, never names or emails. Short CDN cache;
 * the list only changes while an artist is young.
 */

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  if (!getArtistBySlug(slug)) {
    return NextResponse.json({ error: 'Unknown artist' }, { status: 404 })
  }

  const response = NextResponse.json({ fans: await getFirstFans(slug) })
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=300, stale-while-revalidate=300',
  )
  return response
}
