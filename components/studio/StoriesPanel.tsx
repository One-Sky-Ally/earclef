'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
 * Draft story-card review, two speeds: a batch view (grouped by artist,
 * select many, approve/reject at once) and a one-by-one view with inline
 * hook/story editing. Decisions write to the Blobs overlay so approvals
 * go live without a deploy.
 */
export function StoriesPanel({ ownerKey }: StoriesPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [mode, setMode] = useState<'batch' | 'single'>('batch')
  const [selected, setSelected] = useState<Set<string>>(new Set())
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

  const groups = useMemo(() => {
    const byArtist = new Map<string, DraftEntry[]>()
    for (const entry of drafts) {
      const list = byArtist.get(entry.card.artistName) ?? []
      byArtist.set(entry.card.artistName, [...list, entry])
    }
    return [...byArtist.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [drafts])

  const entry = drafts[index] as DraftEntry | undefined

  useEffect(() => {
    if (!entry) return
    setHookEdit(entry.decision?.hook ?? entry.card.hook)
    setStoryEdit(entry.decision?.story ?? entry.card.story)
  }, [entry])

  async function post(payload: Record<string, unknown>) {
    const res = await fetch('/api/studio/stories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-owner-key': ownerKey,
      },
      body: JSON.stringify(payload),
    })
    return res.ok
  }

  async function bulk(action: 'approve' | 'reject') {
    if (selected.size === 0 || saving) return
    setSaving(true)
    try {
      if (await post({ ids: [...selected], action })) {
        setSelected(new Set())
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function decideSingle(action: 'approve' | 'reject' | 'reset') {
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
      if (await post(payload)) await load()
    } finally {
      setSaving(false)
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(entries: DraftEntry[]) {
    const undecided = entries.filter((e) => !e.decision).map((e) => e.card.id)
    setSelected((current) => {
      const allIn = undecided.every((id) => current.has(id))
      const next = new Set(current)
      for (const id of undecided) {
        if (allIn) next.delete(id)
        else next.add(id)
      }
      return next
    })
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

  const undecidedCount = drafts.filter((d) => !d.decision).length

  return (
    <div className={styles.panel}>
      <div className={styles.modeRow}>
        <button
          type="button"
          className={mode === 'batch' ? styles.modeActive : styles.modeButton}
          onClick={() => setMode('batch')}
        >
          Batch by artist
        </button>
        <button
          type="button"
          className={mode === 'single' ? styles.modeActive : styles.modeButton}
          onClick={() => setMode('single')}
        >
          One by one
        </button>
        <span className={styles.modeCount}>
          {undecidedCount} undecided of {drafts.length}
        </span>
      </div>

      {mode === 'batch' && (
        <>
          <div className={styles.bulkBar}>
            <button
              type="button"
              className={styles.approve}
              disabled={selected.size === 0 || saving}
              onClick={() => bulk('approve')}
            >
              Approve selected ({selected.size})
            </button>
            <button
              type="button"
              className={styles.reject}
              disabled={selected.size === 0 || saving}
              onClick={() => bulk('reject')}
            >
              Reject selected
            </button>
          </div>
          {groups.map(([artistName, entries]) => (
            <div key={artistName} className={styles.group}>
              <label className={styles.groupHeader}>
                <input
                  type="checkbox"
                  checked={entries
                    .filter((e) => !e.decision)
                    .every((e) => selected.has(e.card.id)) &&
                    entries.some((e) => !e.decision)}
                  onChange={() => toggleGroup(entries)}
                />
                <span className={styles.groupName}>{artistName}</span>
                <span className={styles.groupCount}>{entries.length}</span>
              </label>
              <ul className={styles.rowList}>
                {entries.map((draft) => (
                  <li key={draft.card.id} className={styles.row}>
                    {draft.decision ? (
                      <span className={styles.rowDecided}>
                        {draft.decision.action === 'approve' ? '✓' : '✗'}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={selected.has(draft.card.id)}
                        onChange={() => toggle(draft.card.id)}
                      />
                    )}
                    <span className={styles.rowText}>
                      <span className={styles.rowHook}>{draft.card.hook}</span>
                      <span className={styles.rowHold}>
                        {draft.card.holdReason ?? ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {mode === 'single' && entry && (
        <SingleView
          drafts={drafts}
          index={Math.min(index, drafts.length - 1)}
          setIndex={setIndex}
          hookEdit={hookEdit}
          storyEdit={storyEdit}
          setHookEdit={setHookEdit}
          setStoryEdit={setStoryEdit}
          saving={saving}
          decide={decideSingle}
        />
      )}
    </div>
  )
}

interface SingleViewProps {
  drafts: DraftEntry[]
  index: number
  setIndex: (index: number) => void
  hookEdit: string
  storyEdit: string
  setHookEdit: (value: string) => void
  setStoryEdit: (value: string) => void
  saving: boolean
  decide: (action: 'approve' | 'reject' | 'reset') => void
}

function SingleView({
  drafts,
  index,
  setIndex,
  hookEdit,
  storyEdit,
  setHookEdit,
  setStoryEdit,
  saving,
  decide,
}: SingleViewProps) {
  const current = drafts[index]
  const decided = current.decision?.action

  return (
    <>
      <div className={styles.pager}>
        <button
          type="button"
          className={styles.pageButton}
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          ← Prev
        </button>
        <span className={styles.pageLabel}>
          Draft {index + 1} of {drafts.length} — {current.card.artistName}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          disabled={index >= drafts.length - 1}
          onClick={() => setIndex(index + 1)}
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
    </>
  )
}
