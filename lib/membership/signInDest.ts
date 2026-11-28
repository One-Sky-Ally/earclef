/**
 * Where a magic link may return the visitor besides an artist page: a
 * FIXED allowlist, never a caller-supplied path. Discover's Follow
 * signs in from the Artists page and from All past picks (Nov 28 2026).
 */
const DESTINATIONS = ['/me', '/artists', '/discover/past'] as const

export type SignInDestination = (typeof DESTINATIONS)[number]

export function signInDestination(value: unknown): SignInDestination | undefined {
  return DESTINATIONS.find((dest) => dest === value)
}

/** The page the verified link lands on. */
export function signInLanding(dest: unknown, slug: string | undefined): string {
  const allowed = signInDestination(dest)
  return allowed ? `${allowed}?signin=ok` : `/${slug ?? ''}?signin=ok#universe`
}
