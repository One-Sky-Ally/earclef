import { NextResponse } from 'next/server'
import { clearSessionCookieHeader } from '@/lib/membership/session'

export async function POST() {
  const response = NextResponse.json({ signedOut: true })
  response.headers.set('Set-Cookie', clearSessionCookieHeader())
  response.headers.set('Cache-Control', 'no-store')
  return response
}
