/**
 * Owner gate for write endpoints on an account-less site: a single
 * passphrase (OWNER_KEY env var) sent as the x-owner-key header. Compared
 * via SHA-256 digests so the comparison is constant-time regardless of
 * input length. Server-side validation is the real boundary — hiding the
 * buttons client-side is just politeness.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export function isOwner(request: Request): boolean {
  const expected = process.env.OWNER_KEY
  const provided = request.headers.get('x-owner-key')
  if (!expected || !provided) return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(provided).digest()
  return timingSafeEqual(a, b)
}

export function unauthorized(): Response {
  return Response.json({ error: 'Owner key required' }, { status: 401 })
}
