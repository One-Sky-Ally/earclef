import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { blurbKey } from '@/lib/feed/blurbKey'
import { readCachedBlurbs, type BlurbRequestItem } from '@/lib/feed/blurbs'

/**
 * Blurbs for the feed's featured items — SERVE-FROM-CACHE ONLY. This
 * route never calls a model: generation happens locally in Claude Code
 * (scripts/warm-blurbs.mjs, on the owner's plan) and lands in the Blobs
 * cache via the owner-gated /api/studio/seed-blurbs endpoint. Cache
 * misses simply come back without a blurb until the next local warm run.
 */

const MAX_ITEMS = 12

interface RawItem {
  slug?: string
  artistName?: string
  title?: string
  type?: string
  date?: string
}

function sanitize(raw: RawItem[]): BlurbRequestItem[] {
  const items: BlurbRequestItem[] = []
  for (const item of raw.slice(0, MAX_ITEMS)) {
    const type = item.type === 'video' ? 'video' : 'release'
    const title = item.title?.toString().trim().slice(0, 200)
    const date = item.date?.toString().slice(0, 10) ?? ''
    const slug = item.slug?.toString() ?? ''
    // Roster-verified artists only — this endpoint spends model tokens.
    const content = getArtistBySlug(slug)
    if (!content || !title) continue
    items.push({
      slug,
      artistName: content.hero.name,
      title,
      type,
      date,
    })
  }
  return items
}

export async function POST(request: Request) {
  let body: { items?: RawItem[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items[] required' }, { status: 400 })
  }

  const items = sanitize(body.items)
  const keys = items.map((item) => blurbKey(item.slug, item.type, item.title))
  const cached = await readCachedBlurbs(keys)

  const response = NextResponse.json({ blurbs: cached })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
