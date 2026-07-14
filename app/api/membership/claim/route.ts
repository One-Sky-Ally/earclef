import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { sessionCookieHeader } from '@/lib/membership/session'
import { getMember, putMember } from '@/lib/membership/store'
import {
  retrieveCheckout,
  stripeConfigured,
} from '@/lib/membership/stripeClient'
import { extendMembership, normalizeEmail } from '@/lib/membership/types'

/**
 * Stripe success redirect. Verifies the session server-side with Stripe
 * (the session id alone proves nothing), records the year, signs the
 * buyer in, and lands them inside the Universe. Idempotent alongside the
 * webhook: extendMembership keyed to the session id is applied once.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session_id') ?? ''
  const slug = url.searchParams.get('slug') ?? ''
  const content = getArtistBySlug(slug)

  if (!content?.membership?.enabled || !sessionId || !stripeConfigured()) {
    return NextResponse.redirect(new URL('/', request.url), { status: 302 })
  }

  try {
    const session = await retrieveCheckout(sessionId, content.membership)
    const email = normalizeEmail(session.customer_details?.email ?? '')
    const paid = session.payment_status === 'paid'
    const rightArtist = session.metadata?.artistSlug === slug
    if (!paid || !rightArtist || !email) {
      return NextResponse.redirect(
        new URL(`/${slug}?joined=failed#universe`, request.url),
        { status: 302 },
      )
    }

    const existing = await getMember(slug, email)
    if (existing?.stripeSessionId !== sessionId) {
      await putMember(
        extendMembership(existing, {
          email,
          artistSlug: slug,
          source: 'stripe',
          stripeSessionId: sessionId,
        }),
      )
    }

    const response = NextResponse.redirect(
      new URL(`/${slug}?joined=1#universe`, request.url),
      { status: 302 },
    )
    response.headers.set('Set-Cookie', sessionCookieHeader(email))
    return response
  } catch (error) {
    console.error('Claim failed:', error)
    return NextResponse.redirect(
      new URL(`/${slug}?joined=failed#universe`, request.url),
      { status: 302 },
    )
  }
}
