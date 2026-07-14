/**
 * The subscriber session: one httpOnly cookie holding a signed token with
 * the member's email. No accounts, no passwords — the cookie IS the
 * identity, and the members store decides what it can see.
 */
import { SESSION_TTL_MS, signToken, verifyToken } from './tokens'
import { getMember } from './store'
import { isActive, type MemberRecord } from './types'

const COOKIE_NAME = 'earclef_member'

export function sessionCookieHeader(email: string, now = Date.now()): string {
  const token = signToken({
    t: 'session',
    email,
    exp: now + SESSION_TTL_MS,
  })
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/** Email from a valid session cookie, or null. */
export function sessionEmail(request: Request): string | null {
  const cookies = request.headers.get('cookie')
  if (!cookies) return null
  const match = cookies
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
  if (!match) return null
  const payload = verifyToken(match.slice(COOKIE_NAME.length + 1), 'session')
  return payload?.email ?? null
}

/**
 * The gate: resolves the request to an ACTIVE member record for the given
 * artist, or null. Every members-only route goes through this.
 */
export async function activeMember(
  request: Request,
  artistSlug: string,
): Promise<MemberRecord | null> {
  const email = sessionEmail(request)
  if (!email) return null
  const record = await getMember(artistSlug, email)
  return isActive(record) ? record : null
}
