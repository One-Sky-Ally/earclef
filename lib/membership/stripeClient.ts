/**
 * Stripe, shaped for federation from day one. A membership year is a
 * ONE-TIME Checkout payment (mode: 'payment') — never a Stripe Billing
 * subscription — so auto-renewal is structurally impossible.
 *
 * Whose Stripe account takes the charge comes from the artist's content
 * JSON: no `membership.stripeAccountId` (Aplete today) means the platform
 * account itself; a future artist's Connect Standard account id routes the
 * same call to THEIR account as a direct charge, where the platform's
 * artist-protective sliding fee (0.01–3%) plugs in as an application fee.
 */
import Stripe from 'stripe'
import type { ArtistContent, MembershipContent } from '../types'

/**
 * Sliding-scale platform fee for connected (federated) artists. Zero for
 * the prototype — the economics get set when the second artist connects.
 */
const PLATFORM_FEE_RATE = 0

let client: Stripe | null = null

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
  if (!client) client = new Stripe(key)
  return client
}

/** Per-request options that route a call to a connected artist account. */
function connectOptions(
  membership: MembershipContent,
): Stripe.RequestOptions | undefined {
  return membership.stripeAccountId
    ? { stripeAccount: membership.stripeAccountId }
    : undefined
}

export async function createYearCheckout(args: {
  content: ArtistContent
  origin: string
  /** Locks the payer email (renewal links); Checkout collects it otherwise. */
  email?: string
  renewal?: boolean
}): Promise<Stripe.Checkout.Session> {
  const membership = args.content.membership
  if (!membership?.enabled) throw new Error('Membership not enabled')
  const slug = args.content.slug
  const amount = Math.round(membership.priceUsd * 100)
  const fee = Math.round(amount * PLATFORM_FEE_RATE)

  return stripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name: `${args.content.hero.name} — ${membership.perkTitle}: one year`,
              description:
                'One year of members-only posts. No auto-renewal — it simply ends, with one reminder near the end.',
            },
          },
        },
      ],
      metadata: {
        artistSlug: slug,
        renewal: args.renewal ? '1' : '0',
      },
      customer_email: args.email,
      payment_intent_data:
        membership.stripeAccountId && fee > 0
          ? { application_fee_amount: fee }
          : undefined,
      success_url: `${args.origin}/api/membership/claim?session_id={CHECKOUT_SESSION_ID}&slug=${slug}`,
      cancel_url: `${args.origin}/${slug}#universe`,
    },
    connectOptions(membership),
  )
}

export async function retrieveCheckout(
  sessionId: string,
  membership: MembershipContent,
): Promise<Stripe.Checkout.Session> {
  return stripe().checkout.sessions.retrieve(
    sessionId,
    {},
    connectOptions(membership),
  )
}

/** Verifies a webhook payload against STRIPE_WEBHOOK_SECRET. */
export async function verifyWebhook(
  rawBody: string,
  signature: string,
): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured')
  return stripe().webhooks.constructEventAsync(rawBody, signature, secret)
}
