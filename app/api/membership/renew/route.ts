import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { siteOrigin } from '@/lib/membership/origin'
import {
  createYearCheckout,
  stripeConfigured,
} from '@/lib/membership/stripeClient'
import { verifyToken } from '@/lib/membership/tokens'

/**
 * The one-click renew link from reminder emails: a signed token straight
 * into a prefilled Checkout. The token only identifies WHO is renewing —
 * money still moves only on the Stripe page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const payload = verifyToken(url.searchParams.get('token') ?? '', 'renew')
  const content = payload?.slug ? getArtistBySlug(payload.slug) : undefined

  if (!payload || !content?.membership?.enabled) {
    return NextResponse.redirect(
      new URL('/?renew=expired', request.url),
      { status: 302 },
    )
  }
  if (!stripeConfigured()) {
    return NextResponse.redirect(
      new URL(`/${payload.slug}?renew=unavailable#universe`, request.url),
      { status: 302 },
    )
  }

  try {
    const session = await createYearCheckout({
      content,
      origin: siteOrigin(request),
      email: payload.email,
      renewal: true,
    })
    return NextResponse.redirect(session.url ?? new URL('/', request.url), {
      status: 302,
    })
  } catch (error) {
    console.error('Renew checkout failed:', error)
    return NextResponse.redirect(
      new URL(`/${payload.slug}?renew=failed#universe`, request.url),
      { status: 302 },
    )
  }
}
