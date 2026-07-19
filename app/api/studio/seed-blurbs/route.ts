import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import { seedBlurbs } from '@/lib/feed/blurbs'

/**
 * Owner-only: seed locally-generated feed blurbs into the Blobs cache.
 * The public blurbs route is serve-from-cache only; this is the single
 * write path, fed by scripts/warm-blurbs.mjs running in Claude Code.
 */

const KEY_PATTERN = /^v2\/[a-z0-9-]+\/(release|video)\/[^/]{1,220}$/
const MAX_BATCH = 60

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: { blurbs?: Record<string, string>; model?: string }
  try {
    body = (await request.json()) as {
      blurbs?: Record<string, string>
      model?: string
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const entries = Object.entries(body.blurbs ?? {}).filter(
    ([key, text]) =>
      KEY_PATTERN.test(key) &&
      typeof text === 'string' &&
      text.trim().length > 0 &&
      text.length <= 500,
  )
  if (entries.length === 0 || entries.length > MAX_BATCH) {
    return NextResponse.json({ error: 'Bad blurbs batch' }, { status: 400 })
  }

  const model =
    typeof body.model === 'string' && body.model.length <= 60
      ? body.model
      : 'local'
  const written = await seedBlurbs(Object.fromEntries(entries), model)
  return NextResponse.json({ ok: true, written: written.length })
}
