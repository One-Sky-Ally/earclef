'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  TIER_LABELS,
  TIER_ORDER,
  type ArtistTier,
} from '@/lib/tiers'
import {
  clearOwnerKey,
  getOwnerKey,
  setOwnerKey,
} from '@/lib/curation/ownerClient'
import type { FollowEntry } from '@/lib/curation/followStore'
import styles from './StudioClient.module.css'

interface RosterRow {
  slug: string
  name: string
  tier: ArtistTier | null
}

interface StudioData {
  queue: FollowEntry[]
  roster: RosterRow[]
  retierConfigured: boolean
}

type StudioState =
  | { status: 'locked'; error?: string }
  | { status: 'checking' }
  | { status: 'ready'; key: string; data: StudioData }

type RowStatus = { kind: 'saving' } | { kind: 'committed' } | { kind: 'error'; message: string }

function buildRequestText(entry: FollowEntry): string {
  return `Add ${entry.name} (MusicBrainz ID ${entry.mbid}) to the Ear Clef roster using the standard verified-research process. Start them at tier "on-the-radar". Once the page is live, remove them from the following queue.`
}

export function StudioClient() {
  const [state, setState] = useState<StudioState>({ status: 'checking' })
  const [passcode, setPasscode] = useState('')
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({})
  const [copiedMbid, setCopiedMbid] = useState<string | null>(null)

  const unlock = useCallback(async (key: string) => {
    setState({ status: 'checking' })
    try {
      const res = await fetch('/api/studio', {
        headers: { 'x-owner-key': key },
      })
      if (res.status === 401) {
        clearOwnerKey()
        setState({ status: 'locked', error: 'That passcode was not accepted.' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setOwnerKey(key)
      setState({ status: 'ready', key, data: (await res.json()) as StudioData })
    } catch {
      setState({
        status: 'locked',
        error: 'The studio could not load — please try again shortly.',
      })
    }
  }, [])

  useEffect(() => {
    const stored = getOwnerKey()
    if (stored) unlock(stored)
    else setState({ status: 'locked' })
  }, [unlock])

  async function removeFromQueue(mbid: string) {
    if (state.status !== 'ready') return
    const res = await fetch('/api/follow', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-owner-key': state.key,
      },
      body: JSON.stringify({ mbid }),
    })
    if (res.ok) {
      const body = (await res.json()) as { entries: FollowEntry[] }
      setState({
        ...state,
        data: { ...state.data, queue: body.entries },
      })
    }
  }

  async function copyBuildRequest(entry: FollowEntry) {
    try {
      await navigator.clipboard.writeText(buildRequestText(entry))
      setCopiedMbid(entry.mbid)
      setTimeout(() => setCopiedMbid(null), 2000)
    } catch {
      // Clipboard unavailable — the text is visible in the row title.
    }
  }

  async function retier(slug: string, tier: ArtistTier) {
    if (state.status !== 'ready') return
    setRowStatus((current) => ({ ...current, [slug]: { kind: 'saving' } }))
    try {
      const res = await fetch('/api/studio/retier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-key': state.key,
        },
        body: JSON.stringify({ slug, tier }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setRowStatus((current) => ({ ...current, [slug]: { kind: 'committed' } }))
      setState((current) =>
        current.status === 'ready'
          ? {
              ...current,
              data: {
                ...current.data,
                roster: current.data.roster.map((row) =>
                  row.slug === slug ? { ...row, tier } : row,
                ),
              },
            }
          : current,
      )
    } catch (error) {
      setRowStatus((current) => ({
        ...current,
        [slug]: { kind: 'error', message: (error as Error).message },
      }))
    }
  }

  if (state.status === 'checking') {
    return <p className={styles.quiet}>Opening the studio…</p>
  }

  if (state.status === 'locked') {
    return (
      <form
        className={styles.gate}
        onSubmit={(event) => {
          event.preventDefault()
          if (passcode.trim()) unlock(passcode.trim())
        }}
      >
        <label className={styles.gateLabel}>
          <span>Owner passcode</span>
          <input
            className={styles.gateInput}
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className={styles.gateSubmit} type="submit">
          Unlock
        </button>
        {state.error && <p className={styles.error}>{state.error}</p>}
      </form>
    )
  }

  const { queue, roster, retierConfigured } = state.data
  const groups: { tier: ArtistTier | null; rows: RosterRow[] }[] = [
    ...TIER_ORDER.map((tier) => ({
      tier: tier as ArtistTier | null,
      rows: roster.filter((row) => row.tier === tier),
    })),
    { tier: null, rows: roster.filter((row) => !row.tier) },
  ].filter((group) => group.rows.length > 0)

  return (
    <div className={styles.studio}>
      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className={styles.heading}>
          Following — pages pending
        </h2>
        {queue.length === 0 ? (
          <p className={styles.quiet}>
            Nothing queued. Follow an artist from Discover and they land here.
          </p>
        ) : (
          <ul className={styles.queue}>
            {queue.map((entry) => (
              <li
                key={entry.mbid}
                className={styles.queueRow}
                title={buildRequestText(entry)}
              >
                <div className={styles.queueText}>
                  <span className={styles.queueName}>{entry.name}</span>
                  {entry.why && (
                    <span className={styles.queueWhy}>{entry.why}</span>
                  )}
                  <span className={styles.queueMeta}>
                    followed {entry.followedAt} · starts on-the-radar
                  </span>
                </div>
                <div className={styles.queueActions}>
                  {entry.listenHref && (
                    <a
                      className={styles.action}
                      href={entry.listenHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ▶ Listen
                    </a>
                  )}
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => copyBuildRequest(entry)}
                  >
                    {copiedMbid === entry.mbid ? 'Copied ✓' : 'Copy build request'}
                  </button>
                  <button
                    type="button"
                    className={styles.actionMuted}
                    onClick={() => removeFromQueue(entry.mbid)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.hint}>
          Paste a build request into a Claude session to grow the roster —
          pages go through the same verified research as everyone else.
        </p>
      </section>

      <section aria-labelledby="tiers-heading">
        <h2 id="tiers-heading" className={styles.heading}>
          Tier board
        </h2>
        {!retierConfigured && (
          <p className={styles.quiet}>
            Read-only for now — add a GITHUB_CONTENT_TOKEN to Netlify to
            enable one-click retiering.
          </p>
        )}
        {groups.map((group) => (
          <div key={group.tier ?? 'untiered'} className={styles.tierGroup}>
            <h3 className={styles.tierLabel}>
              {group.tier ? TIER_LABELS[group.tier] : 'Untiered'}
              <span className={styles.tierCount}>{group.rows.length}</span>
            </h3>
            <ul className={styles.tierList}>
              {group.rows.map((row) => {
                const status = rowStatus[row.slug]
                return (
                  <li key={row.slug} className={styles.tierRow}>
                    <span className={styles.tierName}>{row.name}</span>
                    <select
                      className={styles.tierSelect}
                      value={row.tier ?? ''}
                      disabled={!retierConfigured || status?.kind === 'saving'}
                      onChange={(event) =>
                        retier(row.slug, event.target.value as ArtistTier)
                      }
                    >
                      {row.tier === null && <option value="">—</option>}
                      {TIER_ORDER.map((tier) => (
                        <option key={tier} value={tier}>
                          {TIER_LABELS[tier]}
                        </option>
                      ))}
                    </select>
                    {status?.kind === 'saving' && (
                      <span className={styles.status}>committing…</span>
                    )}
                    {status?.kind === 'committed' && (
                      <span className={styles.status}>
                        committed — live after the next deploy (~1 min)
                      </span>
                    )}
                    {status?.kind === 'error' && (
                      <span className={styles.statusError}>{status.message}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>

      <button
        type="button"
        className={styles.signOut}
        onClick={() => {
          clearOwnerKey()
          setState({ status: 'locked' })
        }}
      >
        Sign out of owner mode
      </button>
    </div>
  )
}
