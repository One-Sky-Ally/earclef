/**
 * Original one-to-two-sentence descriptions for feed items, cached in
 * Blobs forever (a blurb is written once per item, ever). GENERATION IS
 * LOCAL-ONLY: scripts/warm-blurbs.mjs writes them in Claude Code (owner's
 * plan) and seeds them through the owner-gated /api/studio/seed-blurbs
 * endpoint — nothing server-side calls a model. The generation rules
 * (metadata + general knowledge only, never scraped text) live in the
 * warm script's prompt.
 */
import { getStore } from '@netlify/blobs'
import type { FeedItemType } from './blurbKey'

export interface BlurbRequestItem {
  slug: string
  artistName: string
  title: string
  type: FeedItemType
  /** YYYY[-MM[-DD]] */
  date: string
}

const MAX_BLURB_CHARS = 240

let devBlurbs = new Map<string, string>()

function store() {
  return getStore({ name: 'blurbs', consistency: 'strong' })
}

export async function readCachedBlurbs(
  keys: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      try {
        const entry = (await store().get(key, { type: 'json' })) as {
          text?: string
        } | null
        return [key, entry?.text ?? null] as const
      } catch {
        return [key, devBlurbs.get(key) ?? null] as const
      }
    }),
  )
  return Object.fromEntries(
    entries.filter(([, text]) => text !== null),
  ) as Record<string, string>
}

/**
 * Overlong blurbs are trimmed at a sentence boundary, never mid-word; a
 * runaway single sentence is dropped entirely — no blurb beats a
 * fragment that ends "…one of the decade's most innova".
 */
export function tidyBlurb(raw: string | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  if (text.length <= MAX_BLURB_CHARS) return text
  const cut = text.slice(0, MAX_BLURB_CHARS)
  const lastSentenceEnd = cut.lastIndexOf('. ')
  return lastSentenceEnd > 60 ? cut.slice(0, lastSentenceEnd + 1) : null
}

/** Owner-seeded writes from the local warm script. Returns keys written. */
export async function seedBlurbs(
  entries: Record<string, string>,
  model: string,
): Promise<string[]> {
  const written: string[] = []
  for (const [key, raw] of Object.entries(entries)) {
    const clean = tidyBlurb(raw)
    if (!clean) continue
    try {
      await store().setJSON(key, {
        text: clean,
        model,
        at: new Date().toISOString(),
      })
    } catch {
      devBlurbs = new Map(devBlurbs).set(key, clean)
    }
    written.push(key)
  }
  return written
}

