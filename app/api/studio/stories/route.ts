import { NextResponse } from 'next/server'
import { isOwner, unauthorized } from '@/lib/curation/auth'
import {
  draftsForReview,
  writeDecision,
  writeDecisions,
} from '@/lib/stories/store'
import type { StoryDecision } from '@/lib/stories/types'

/** Owner review of held story cards: list drafts, approve/reject/reset. */

export async function GET(request: Request) {
  if (!isOwner(request)) return unauthorized()
  const drafts = await draftsForReview()
  return NextResponse.json({ drafts })
}

interface DecisionBody {
  id?: string
  /** Bulk mode: many ids, one action (no per-card edits). */
  ids?: string[]
  action?: 'approve' | 'reject' | 'reset'
  hook?: string
  story?: string
}

export async function POST(request: Request) {
  if (!isOwner(request)) return unauthorized()

  let body: DecisionBody
  try {
    body = (await request.json()) as DecisionBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, action } = body
  if (action !== 'approve' && action !== 'reject' && action !== 'reset') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter(
      (value) => typeof value === 'string' && value.length <= 200,
    )
    if (ids.length === 0 || ids.length > 400) {
      return NextResponse.json({ error: 'Bad ids batch' }, { status: 400 })
    }
    const at = new Date().toISOString()
    await writeDecisions(
      ids.map((cardId) => ({
        id: cardId,
        decision: action === 'reset' ? null : { action, at },
      })),
    )
    return NextResponse.json({ ok: true, count: ids.length })
  }

  if (!id || typeof id !== 'string' || id.length > 200) {
    return NextResponse.json({ error: 'Card id required' }, { status: 400 })
  }

  if (action === 'reset') {
    await writeDecision(id, null)
    return NextResponse.json({ ok: true })
  }

  const decision: StoryDecision = {
    action,
    at: new Date().toISOString(),
  }
  if (action === 'approve') {
    if (typeof body.hook === 'string' && body.hook.trim()) {
      decision.hook = body.hook.trim().slice(0, 200)
    }
    if (typeof body.story === 'string' && body.story.trim()) {
      decision.story = body.story.trim().slice(0, 2000)
    }
  }
  await writeDecision(id, decision)
  return NextResponse.json({ ok: true })
}
