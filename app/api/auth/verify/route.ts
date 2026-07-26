import { NextResponse } from 'next/server'
import { claimOnce } from '@/lib/membership/markers'
import { sessionCookieHeader } from '@/lib/membership/session'
import { verifyToken } from '@/lib/membership/tokens'

/**
 * Magic-link sign-in, step 2: the emailed link lands here, the token
 * becomes a session cookie, and the visitor returns to the artist page.
 * Links are SINGLE-USE (atomic marker on the token signature) — a
 * forwarded or logged link is dead after the first click. Invalid,
 * expired, and spent links land on the page with a gentle flag instead
 * of an error wall.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  const payload = verifyToken(token, 'magic')

  if (!payload || !(await claimOnce(`magic/${token.split('.')[1]}`))) {
    return NextResponse.redirect(
      new URL('/?signin=expired', request.url),
      { status: 302 },
    )
  }

  // The signed allowlisted destination wins; artist page is the default.
  const destination = new URL(
    payload.d === '/me'
      ? '/me?signin=ok'
      : `/${payload.slug ?? ''}?signin=ok#universe`,
    request.url,
  )
  const response = NextResponse.redirect(destination, { status: 302 })
  response.headers.set('Set-Cookie', sessionCookieHeader(payload.email))
  return response
}
