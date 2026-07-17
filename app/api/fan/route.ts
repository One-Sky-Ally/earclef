import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { getFan, setFollow, setListenService } from '@/lib/fans/store'
import { isListenService } from '@/lib/listen/services'
import { sessionEmail } from '@/lib/membership/session'

/**
 * The fan profile: who the session cookie belongs to and which artists
 * they follow. GET reads; POST toggles one follow. Signed-out visitors
 * get an honest {signedIn: false} — the UI offers magic-link sign-in.
 */

function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request) {
  const email = sessionEmail(request)
  if (!email) return noStore({ signedIn: false, follows: [] })
  const fan = await getFan(email)
  return noStore({
    signedIn: true,
    email,
    follows: fan?.follows ?? [],
    listenService: fan?.listenService,
  })
}

export async function POST(request: Request) {
  const email = sessionEmail(request)
  if (!email) {
    return noStore({ error: 'Sign in to save preferences' }, 401)
  }

  let body: { slug?: string; following?: boolean; listenService?: string }
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400)
  }

  if (body.listenService !== undefined) {
    if (!isListenService(body.listenService)) {
      return noStore({ error: 'Unknown service' }, 400)
    }
    await setListenService(email, body.listenService)
    return noStore({ signedIn: true, listenService: body.listenService })
  }

  const slug = body.slug ?? ''
  if (!getArtistBySlug(slug)) {
    return noStore({ error: 'Unknown artist' }, 404)
  }
  const follows = await setFollow(email, slug, body.following !== false)
  return noStore({ signedIn: true, email, follows })
}
