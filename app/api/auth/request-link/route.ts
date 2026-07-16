import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { sendMagicLink } from '@/lib/membership/email'
import { throttleGate } from '@/lib/membership/markers'
import { siteOrigin } from '@/lib/membership/origin'
import {
  MAGIC_LINK_TTL_MS,
  authConfigured,
  signToken,
} from '@/lib/membership/tokens'
import { EMAIL_PATTERN, normalizeEmail } from '@/lib/membership/types'

/**
 * Magic-link sign-in, step 1. Always answers "sent" for a well-formed
 * email (no membership enumeration); whether the inbox holds a usable
 * link is between the member and their email. Dev mode without Resend
 * returns the link directly so the loop stays testable.
 *
 * Send throttles live in the shared "auth" Blobs store (per email AND
 * per client IP) so they hold across serverless instances — an
 * in-process map would reset on every cold start.
 */

const EMAIL_COOLDOWN_MS = 60 * 1000
const IP_COOLDOWN_MS = 15 * 1000

function clientIp(request: Request): string {
  return (
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return noStore({ error: 'Sign-in is not configured yet' }, 501)
  }

  let body: { email?: string; slug?: string }
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }

  const email = normalizeEmail(body.email ?? '')
  const slug = body.slug ?? ''
  const content = getArtistBySlug(slug)
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return noStore({ error: 'A valid email is required' }, 400)
  }
  // Any roster page can request sign-in: the session is the site-wide fan
  // identity (follows), and doubles as membership access where one exists.
  if (!content) {
    return noStore({ error: 'Unknown artist' }, 404)
  }

  const emailOk = await throttleGate(
    `throttle/email/${email}`,
    EMAIL_COOLDOWN_MS,
  )
  const ipOk = await throttleGate(
    `throttle/ip/${clientIp(request)}`,
    IP_COOLDOWN_MS,
  )
  if (!emailOk || !ipOk) {
    return noStore({ sent: true, throttled: true })
  }

  const token = signToken({
    t: 'magic',
    email,
    slug,
    exp: Date.now() + MAGIC_LINK_TTL_MS,
  })
  const link = `${siteOrigin(request)}/api/auth/verify?token=${encodeURIComponent(token)}`

  const sent = await sendMagicLink({
    to: email,
    artistName: content.hero.name,
    link,
  })
  if (!sent && process.env.NODE_ENV === 'development') {
    // No email service locally — hand the link back for testing.
    return noStore({ sent: true, devLink: link })
  }
  if (!sent && !process.env.RESEND_API_KEY) {
    return noStore({ error: 'Sign-in email is not configured yet' }, 501)
  }
  return noStore({ sent: true })
}
