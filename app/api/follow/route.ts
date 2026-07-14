import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import {
  addFollow,
  readQueue,
  removeFollow,
  type FollowEntry,
} from '@/lib/curation/followStore'

/**
 * The following queue. Reads are public (the pending strip shows visitors
 * what's coming); writes require the owner key.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET() {
  return noStore({ entries: await readQueue() })
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: Partial<FollowEntry>
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }

  const name = body.name?.toString().trim()
  const mbid = body.mbid?.toString().trim().toLowerCase()
  if (!name || name.length > 200 || !mbid || !UUID_PATTERN.test(mbid)) {
    return noStore({ error: 'name and a valid mbid are required' }, 400)
  }

  const entries = await addFollow({
    name,
    mbid,
    why: body.why?.toString().slice(0, 400) || undefined,
    knownFor: body.knownFor?.toString().slice(0, 200) || undefined,
    listenHref: body.listenHref?.toString().slice(0, 500) || undefined,
    followedAt: new Date().toISOString().slice(0, 10),
    tier: 'on-the-radar',
  })
  return noStore({ entries })
}

export async function DELETE(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: { mbid?: string }
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }
  const mbid = body.mbid?.toString().trim().toLowerCase()
  if (!mbid || !UUID_PATTERN.test(mbid)) {
    return noStore({ error: 'A valid mbid is required' }, 400)
  }
  return noStore({ entries: await removeFollow(mbid) })
}
