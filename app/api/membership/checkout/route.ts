import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { siteOrigin } from '@/lib/membership/origin'
import { sessionEmail } from '@/lib/membership/session'
import {
  createYearCheckout,
  stripeConfigured,
} from '@/lib/membership/stripeClient'

/**
 * Starts a one-time "one year" Stripe Checkout. A signed-in member's
 * email rides along so a renewal lands on the same record; new joiners
 * type theirs on the Stripe page.
 */
export async function POST(request: Request) {
  let body: { slug?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const content = getArtistBySlug(body.slug ?? '')
  if (!content?.membership?.enabled) {
    return NextResponse.json({ error: 'No membership here' }, { status: 404 })
  }
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not switched on yet' },
      { status: 501 },
    )
  }

  try {
    const email = sessionEmail(request) ?? undefined
    const session = await createYearCheckout({
      content,
      origin: siteOrigin(request),
      email,
      renewal: Boolean(email),
    })
    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Checkout creation failed:', error)
    return NextResponse.json(
      { error: 'Could not start checkout — please try again shortly' },
      { status: 502 },
    )
  }
}
