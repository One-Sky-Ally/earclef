import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { EMAIL_PATTERN } from '@/lib/membership/types'
import { isListenService } from '@/lib/listen/services'
import { setListenService } from '@/lib/fans/store'

/**
 * Owner-only: set a fan's listening-service preference by email — the
 * signed-in /api/fan path can't be used on someone's behalf. The fan
 * record wins over localStorage on their next visit, so this applies
 * the preference across their devices.
 */
export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: { email?: string; service?: string }
  try {
    body = (await request.json()) as { email?: string; service?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (!isListenService(body.service)) {
    return NextResponse.json({ error: 'Unknown service' }, { status: 400 })
  }

  await setListenService(email, body.service)
  return NextResponse.json({ ok: true, email, service: body.service })
}
