import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { purgeFanFromRegistry } from '@/lib/fans/followNumbers'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { EMAIL_PATTERN, normalizeEmail } from '@/lib/membership/types'

/**
 * Owner-only: retire a fan identity's first-fan numbers. Removes the
 * fan's entry from each named artist registry and compacts the numbers
 * above it, so retired test/owner identities don't hold "Fan #1" slots
 * forever. Explicit slugs only — no accidental roster-wide sweeps.
 * Follows themselves are cleared through the normal /api/fan unfollow.
 */

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: { email?: string; slugs?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = normalizeEmail(body.email ?? '')
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  const slugs = body.slugs ?? []
  if (slugs.length === 0 || slugs.length > 50) {
    return NextResponse.json(
      { error: 'Provide 1-50 explicit slugs' },
      { status: 400 },
    )
  }
  const unknown = slugs.filter((slug) => !getArtistBySlug(slug))
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown slugs: ${unknown.join(', ')}` },
      { status: 400 },
    )
  }

  const results: Record<string, number | null> = {}
  for (const slug of slugs) {
    results[slug] = await purgeFanFromRegistry(slug, email)
  }

  const response = NextResponse.json({ purged: results })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
