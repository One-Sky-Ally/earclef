import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getArtistBySlug } from '@/lib/content'
import {
  getMemberSnapshot,
  putMemberGuarded,
} from '@/lib/membership/store'
import { verifyWebhook } from '@/lib/membership/stripeClient'
import { extendMembership, normalizeEmail } from '@/lib/membership/types'

/**
 * The authoritative recorder: Stripe calls this on completed checkouts,
 * so a paid year lands even if the buyer never returns to the success
 * page. Signature-verified against the raw body; idempotent with the
 * claim route via the session id.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 501 })
  }

  let event: Stripe.Event
  try {
    event = await verifyWebhook(await request.text(), signature)
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const slug = session.metadata?.artistSlug ?? ''
  const email = normalizeEmail(session.customer_details?.email ?? '')
  const content = getArtistBySlug(slug)

  if (
    !content?.membership?.enabled ||
    !email ||
    session.payment_status !== 'paid'
  ) {
    // Acknowledge so Stripe stops retrying; log for the owner.
    console.error('Webhook session ignored:', session.id, slug)
    return NextResponse.json({ received: true })
  }

  // Compare-and-set loop shared with the claim route: whichever writer
  // lands first records the year; the other sees the session id applied
  // and stops. Concurrent deliveries can never stack extra years.
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await getMemberSnapshot(slug, email)
    if (snapshot.record?.stripeSessionId === session.id) break
    const applied = await putMemberGuarded(
      extendMembership(snapshot.record, {
        email,
        artistSlug: slug,
        source: 'stripe',
        stripeSessionId: session.id,
      }),
      snapshot,
    )
    if (applied) break
    if (attempt === 2) {
      // Fail loud so Stripe retries the delivery later.
      return NextResponse.json({ error: 'Write contention' }, { status: 500 })
    }
  }
  return NextResponse.json({ received: true })
}
