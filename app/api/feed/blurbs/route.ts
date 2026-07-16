import { NextResponse } from 'next/server'
import { getArtistBySlug } from '@/lib/content'
import { blurbKey } from '@/lib/feed/blurbKey'
import {
  generateBlurbs,
  readCachedBlurbs,
  type BlurbRequestItem,
} from '@/lib/feed/blurbs'
import { throttleGate } from '@/lib/membership/markers'

/**
 * Blurbs for the feed's featured items. Cached answers are free and
 * always served; misses trigger at most one batched model call, gated by
 * a shared throttle so refresh storms (or abuse) can't stack Haiku calls
 * — un-generated items just come back without a blurb until a later
 * request fills them in.
 */

const MAX_ITEMS = 12
const GENERATE_COOLDOWN_MS = 20 * 1000

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

  const misses = items.filter(
    (item) => !(blurbKey(item.slug, item.type, item.title) in cached),
  )

  let generated: Record<string, string> = {}
  if (
    misses.length > 0 &&
    process.env.ANTHROPIC_API_KEY &&
    (await throttleGate('throttle/blurbs', GENERATE_COOLDOWN_MS))
  ) {
    generated = await generateBlurbs(misses)
  }

  const response = NextResponse.json({ blurbs: { ...cached, ...generated } })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
