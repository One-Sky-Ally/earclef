import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { readPosts } from '@/lib/membership/posts'
import { activeMember, sessionEmail } from '@/lib/membership/session'
import { authConfigured } from '@/lib/membership/tokens'
import { emailConfigured } from '@/lib/membership/email'
import { stripeConfigured } from '@/lib/membership/stripeClient'
import { toTeaser } from '@/lib/membership/types'

/**
 * The Universe gate. Everyone gets the teasers; an active member's session
 * cookie unlocks the full feed. Per-user, so never cached.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const content = getArtistBySlug(slug)
  if (!content?.membership?.enabled) {
    return NextResponse.json({ error: 'No membership here' }, { status: 404 })
  }

  const posts = await readPosts(slug)
  const member = await activeMember(request, slug)

  const body = member
    ? {
        locked: false as const,
        member: {
          email: member.email,
          expiresAt: member.expiresAt,
          source: member.source,
        },
        posts,
      }
    : {
        locked: true as const,
        // A signed-in email with no active membership gets honest copy.
        signedInAs: sessionEmail(request) ?? undefined,
        teasers: posts.map(toTeaser),
        checkoutReady: stripeConfigured(),
        signInReady:
          authConfigured() &&
          (emailConfigured() || process.env.NODE_ENV === 'development'),
      }

  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
