import { NextResponse } from 'next/server'
import { sanitizeMark, sanitizeMarks, MBID } from '@/lib/discover/playedMarks'
import { getFan, mergeDiscoverPlayed, setDiscoverPlayed } from '@/lib/fans/store'
import { sessionEmail } from '@/lib/membership/session'

/**
 * A signed-in fan's Discover "Played" marks, so they follow the fan to
 * any device (owner, Nov 23 2026). Signed-out visitors get
 * {signedIn: false}: their marks stay in their own browser
 * (lib/discover/played.ts) and are never sent here.
 *
 * POST takes exactly one of: {mbid, mark} to mark, {mbid, played: false}
 * to un-mark, or {merge: marks} for marks made before signing in.
 */
function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request) {
  const email = sessionEmail(request)
  if (!email) return noStore({ signedIn: false })
  const fan = await getFan(email)
  return noStore({ signedIn: true, marks: fan?.discoverPlayed ?? {} })
}

interface PlayedPostBody {
  mbid?: unknown
  mark?: unknown
  played?: unknown
  merge?: unknown
}

export async function POST(request: Request) {
  const email = sessionEmail(request)
  if (!email) return noStore({ error: 'Sign in to save Played marks' }, 401)

  let body: PlayedPostBody
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }

  if (body.merge !== undefined) {
    const marks = await mergeDiscoverPlayed(email, sanitizeMarks(body.merge))
    return noStore({ signedIn: true, marks })
  }

  const mbid = typeof body.mbid === 'string' ? body.mbid.toLowerCase() : ''
  if (!MBID.test(mbid)) return noStore({ error: 'Unknown artist id' }, 400)

  if (body.played === false) {
    return noStore({ signedIn: true, marks: await setDiscoverPlayed(email, mbid, null) })
  }
  const mark = sanitizeMark(mbid, body.mark)
  if (!mark) return noStore({ error: 'A mark needs a day' }, 400)
  return noStore({ signedIn: true, marks: await setDiscoverPlayed(email, mbid, mark) })
}
