'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StoryCard, StoryDecision } from '@/lib/stories/types'
import styles from './StoriesPanel.module.css'

interface StoriesPanelProps {
  ownerKey: string
}

interface DraftEntry {
  card: StoryCard
  decision: StoryDecision | null
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; drafts: DraftEntry[] }

/**
 * Draft story-card review: one card at a time, prev/next, approve (with
 * optional inline edits), reject, or undo. Decisions write to the Blobs
 * overlay so approvals go live without a deploy.
 */
export function StoriesPanel({ ownerKey }: StoriesPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [index, setIndex] = useState(0)
  const [hookEdit, setHookEdit] = useState('')
  const [storyEdit, setStoryEdit] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/studio/stories', {
        headers: { 'x-owner-key': ownerKey },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { drafts: DraftEntry[] }
      setState({ status: 'ready', drafts: body.drafts })
    } catch {
      setState({ status: 'error' })
    }
  }, [ownerKey])

  useEffect(() => {
    load()
  }, [load])

  const drafts = state.status === 'ready' ? state.drafts : []
  const entry = drafts[index] as DraftEntry | undefined

  // Seed the edit fields whenever the visible card changes.
  useEffect(() => {
    if (!entry) return
    setHookEdit(entry.decision?.hook ?? entry.card.hook)
    setStoryEdit(entry.decision?.story ?? entry.card.story)
  }, [entry])

  async function decide(action: 'approve' | 'reject' | 'reset') {
    if (!entry || saving) return
    setSaving(true)
    try {
      const payload: Record<string, string> = { id: entry.card.id, action }
      if (action === 'approve') {
        if (hookEdit.trim() !== entry.card.hook) payload.hook = hookEdit.trim()
        if (storyEdit.trim() !== entry.card.story) {
          payload.story = storyEdit.trim()
        }
      }
      const res = await fetch('/api/studio/stories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-key': ownerKey,
        },
        body: JSON.stringify(payload),
      })
      if (res.ok) await load()
    } finally {
      setSaving(false)
    }
  }

  if (state.status === 'loading') {
    return <p className={styles.quiet}>Loading draft stories…</p>
  }
  if (state.status === 'error') {
    return <p className={styles.quiet}>Draft stories could not load.</p>
  }
  if (drafts.length === 0) {
    return (
      <p className={styles.quiet}>
        No story drafts waiting — everything the farm produced either passed
        the source gate or hasn&apos;t run yet.
      </p>
    )
  }

  const clamped = Math.min(index, drafts.length - 1)
  const current = drafts[clamped]
  const decided = current.decision?.action

  return (
    <div className={styles.panel}>
      <div className={styles.pager}>
        <button
          type="button"
          className={styles.pageButton}
          disabled={clamped === 0}
          onClick={() => setIndex(clamped - 1)}
        >
          ← Prev
        </button>
        <span className={styles.pageLabel}>
          Draft {clamped + 1} of {drafts.length} — {current.card.artistName}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          disabled={clamped >= drafts.length - 1}
          onClick={() => setIndex(clamped + 1)}
        >
          Next →
        </button>
      </div>

      <p className={styles.holdReason}>
        Held: {current.card.holdReason ?? 'no reason recorded'}
      </p>

      <label className={styles.field}>
        <span>Hook</span>
        <input
          className={styles.input}
          value={hookEdit}
          onChange={(event) => setHookEdit(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>Story</span>
        <textarea
          className={styles.textarea}
          rows={5}
          value={storyEdit}
          onChange={(event) => setStoryEdit(event.target.value)}
        />
      </label>

      {current.card.media.length > 0 && (
        <ul className={styles.mediaList}>
          {current.card.media.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer">
                ▶ {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <ul className={styles.sourceList}>
        {current.card.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.publisher} — {source.title}
            </a>
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        {decided ? (
          <>
            <span className={styles.decided}>
              {decided === 'approve' ? '✓ Approved' : '✗ Rejected'}
            </span>
            <button
              type="button"
              className={styles.actionMuted}
              disabled={saving}
              onClick={() => decide('reset')}
            >
              Undo
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.approve}
              disabled={saving}
              onClick={() => decide('approve')}
            >
              Approve &amp; publish
            </button>
            <button
              type="button"
              className={styles.reject}
              disabled={saving}
              onClick={() => decide('reject')}
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  )
}
