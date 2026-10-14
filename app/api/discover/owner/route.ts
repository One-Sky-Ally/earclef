import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { readLatestPool, readPool } from '@/lib/discover/store'
import { readFixture, sanitizePool } from '@/lib/discover/serve'

/**
 * The OWNER's own Discover pool — picks from the rows in the owner's
 * linked fan account (lib/discover/library.ts), generated nightly at
 * 00:40 UTC. Owner key only, never cached by the CDN. Until the first
 * owner pool exists this answers {status: 'none'} and the page shows the
 * shared picks instead. Read-only: no request ever triggers a model call.
 */
function privateJson(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()

  const fixture = await readFixture(process.env.DISCOVER_OWNER_FIXTURE)
  if (fixture) return privateJson({ status: 'ready', pool: sanitizePool(fixture) })

  const today = new Date().toISOString().slice(0, 10)
  const pool = (await readPool(today, 'owner')) ?? (await readLatestPool('owner'))
  return privateJson(pool ? { status: 'ready', pool: sanitizePool(pool) } : { status: 'none' })
}
