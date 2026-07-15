import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { sessionCookieHeader } from '@/lib/membership/session'
import {
  getMemberSnapshot,
  putMemberGuarded,
} from '@/lib/membership/store'
import {
  retrieveCheckout,
  stripeConfigured,
} from '@/lib/membership/stripeClient'
import { extendMembership, normalizeEmail } from '@/lib/membership/types'

/**
 * Stripe success redirect. Verifies the session server-side with Stripe
 * (the session id alone proves nothing), records the year, signs the
 * buyer in, and lands them inside the Universe.
 *
 * Two hard rules, because success URLs outlive the purchase in browser
 * history and logs:
 * - a session id mints a sign-in cookie ONCE (claimedAt); replays land
 *   on the page and are pointed at magic-link sign-in instead
 * - recording the year is a compare-and-set loop shared with the
 *   webhook, so concurrent deliveries can never stack extra years
 */

const WRITE_ATTEMPTS = 3

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

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const snapshot = await getMemberSnapshot(slug, email)
      const existing = snapshot.record
      const recorded = existing?.stripeSessionId === sessionId

      if (recorded && existing?.claimedAt) {
        // Replayed success URL: membership is fine, but no cookie —
        // sign-in goes through the magic-link form.
        return NextResponse.redirect(
          new URL(`/${slug}?signin=needed#universe`, request.url),
          { status: 302 },
        )
      }

      const claimStamp = new Date().toISOString()
      const next = recorded
        ? { ...existing!, claimedAt: claimStamp }
        : {
            ...extendMembership(existing, {
              email,
              artistSlug: slug,
              source: 'stripe' as const,
              stripeSessionId: sessionId,
            }),
            claimedAt: claimStamp,
          }

      if (await putMemberGuarded(next, snapshot)) {
        const response = NextResponse.redirect(
          new URL(`/${slug}?joined=1#universe`, request.url),
          { status: 302 },
        )
        response.headers.set('Set-Cookie', sessionCookieHeader(email))
        return response
      }
      // Lost the write race (likely to the webhook) — re-read and retry.
    }
    return NextResponse.redirect(
      new URL(`/${slug}?signin=needed#universe`, request.url),
      { status: 302 },
    )
  } catch (error) {
    console.error('Claim failed:', error)
    return NextResponse.redirect(
      new URL(`/${slug}?joined=failed#universe`, request.url),
      { status: 302 },
    )
  }
}
