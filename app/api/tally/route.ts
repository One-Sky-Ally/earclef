import { isTallyKind, isTallySection } from '@/lib/tally/counts'
import { addCount } from '@/lib/tally/store'

/**
 * Anonymous counts (lib/tally/counts.ts): { k: "play"|"save"|"share",
 * s: <section> } adds one to today's totals. Nothing about the request —
 * address, browser, cookies — is read or kept. Anything else is refused.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 200) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  const { k, s } = (body ?? {}) as { k?: unknown; s?: unknown }
  if (!isTallyKind(k) || !isTallySection(s)) {
    return new Response(null, { status: 400 })
  }
  await addCount(k, s)
  return new Response(null, { status: 204 })
}
