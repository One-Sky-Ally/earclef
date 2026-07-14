/**
 * Compact signed tokens for magic links, renewal links, and the session
 * cookie: base64url(JSON payload) + "." + base64url(HMAC-SHA256). No JWT
 * dependency — one secret (AUTH_SECRET), constant-time verification.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface TokenPayload {
  t: 'magic' | 'renew' | 'session'
  email: string
  /** Artist page the token belongs to (magic/renew) — session is global. */
  slug?: string
  /** Unix ms expiry. */
  exp: number
}

export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET)
}

function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

function hmac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

export function signToken(payload: TokenPayload): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET not configured')
  const body = base64url(JSON.stringify(payload))
  return `${body}.${base64url(hmac(body, secret))}`
}

export function verifyToken(
  token: string,
  expectedType: TokenPayload['t'],
  now = Date.now(),
): TokenPayload | null {
  const secret = process.env.AUTH_SECRET
  if (!secret) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  const expected = hmac(body, secret)
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as TokenPayload
    if (payload.t !== expectedType) return null
    if (typeof payload.exp !== 'number' || payload.exp < now) return null
    if (typeof payload.email !== 'string' || !payload.email) return null
    return payload
  } catch {
    return null
  }
}

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
export const RENEW_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000
