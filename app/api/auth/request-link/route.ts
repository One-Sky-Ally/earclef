import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { sendMagicLink } from '@/lib/membership/email'
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
 */

// Per-process brake on repeat sends; real abuse control is Resend's quota.
const lastSend = new Map<string, number>()
const RESEND_COOLDOWN_MS = 60 * 1000

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
  if (!content?.membership?.enabled) {
    return noStore({ error: 'No membership here' }, 404)
  }

  const now = Date.now()
  const last = lastSend.get(email) ?? 0
  if (now - last < RESEND_COOLDOWN_MS) {
    return noStore({ sent: true, throttled: true })
  }
  lastSend.set(email, now)

  const token = signToken({
    t: 'magic',
    email,
    slug,
    exp: now + MAGIC_LINK_TTL_MS,
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
