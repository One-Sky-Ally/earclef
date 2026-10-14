'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { safeStoredHref, storedHrefKind } from '@/lib/play/storedHref'
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
import { UniversePanel } from '@/components/studio/UniversePanel'
import { StoriesPanel } from '@/components/studio/StoriesPanel'
import styles from './StudioClient.module.css'

interface RosterRow {
  slug: string
  name: string
  tier: ArtistTier | null
  membership?: boolean
}

interface StudioData {
  queue: FollowEntry[]
  roster: RosterRow[]
  retierConfigured: boolean
  /** The fan account signed in on this browser, if any. */
  account: { email: string; follows: number; claimedAt: string | null } | null
  /** The account the owner's own Discover picks follow, if linked. */
  discoverAccount: string | null
}

interface ClaimResult {
  email: string
  added: number
  placed: Record<ArtistTier, number>
  kept: string[]
  claimedAt: string
}

type ClaimState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done'; result: ClaimResult }
  | { kind: 'error'; message: string }

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
  const [claim, setClaim] = useState<ClaimState>({ kind: 'idle' })
  const [linkError, setLinkError] = useState<string | null>(null)

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

  async function claimTiers() {
    if (state.status !== 'ready') return
    setClaim({ kind: 'saving' })
    try {
      const res = await fetch('/api/studio/claim-tiers', {
        method: 'POST',
        headers: { 'x-owner-key': state.key },
      })
      const body = (await res.json()) as Partial<ClaimResult> & {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setClaim({ kind: 'done', result: body as ClaimResult })
      // The copy also links this account for the owner's Discover picks.
      setDiscoverAccount(body.email ?? null)
    } catch (error) {
      setClaim({ kind: 'error', message: (error as Error).message })
    }
  }

  function setDiscoverAccount(email: string | null) {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, data: { ...current.data, discoverAccount: email } }
        : current,
    )
  }

  async function linkAccount() {
    if (state.status !== 'ready') return
    setLinkError(null)
    try {
      const res = await fetch('/api/studio/owner-account', {
        method: 'POST',
        headers: { 'x-owner-key': state.key },
      })
      const body = (await res.json()) as { ok?: boolean; email?: string; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setDiscoverAccount(body.email ?? null)
    } catch (error) {
      setLinkError((error as Error).message)
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

  const { queue, roster, retierConfigured, account, discoverAccount } = state.data
  const nameOf = new Map(roster.map((row) => [row.slug, row.name]))
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
                      href={safeStoredHref(entry.listenHref, entry.mbid)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {storedHrefKind(
                        safeStoredHref(entry.listenHref, entry.mbid),
                      ) === 'play'
                        ? '▶ Listen'
                        : 'About'}
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

      {roster.some((row) => row.membership) && (
        <section aria-labelledby="universe-heading">
          <h2 id="universe-heading" className={styles.heading}>
            The Universe
          </h2>
          {roster
            .filter((row) => row.membership)
            .map((row) => (
              <UniversePanel
                key={row.slug}
                ownerKey={state.key}
                slug={row.slug}
                artistName={row.name}
              />
            ))}
        </section>
      )}

      <section aria-labelledby="stories-heading">
        <h2 id="stories-heading" className={styles.heading}>
          Story drafts
        </h2>
        <StoriesPanel ownerKey={state.key} />
      </section>

      <section aria-labelledby="claim-heading">
        <h2 id="claim-heading" className={styles.heading}>
          Your rotation groups → your account
        </h2>
        <p className={styles.lead}>
          Visitors no longer see these groups: the Artists page shows them a
          random mix, and signed-in listeners see their own rows. To keep
          yours, copy them into your fan account — the one signed in on this
          browser. Safe to repeat: nothing you already follow is removed, and
          a tier you already chose in your account is kept.
        </p>
        {!account ? (
          <p className={styles.quiet}>
            No fan account is signed in on this browser.{' '}
            <Link className={styles.inlineLink} href="/me">
              Sign in on My Taste Map
            </Link>
            , then come back here.
          </p>
        ) : (
          <>
            <p className={styles.quiet}>
              Signed in as {account.email} · following {account.follows}
              {account.claimedAt &&
                ` · groups copied ${account.claimedAt.slice(0, 10)}`}
            </p>
            <button
              type="button"
              className={styles.claim}
              onClick={claimTiers}
              disabled={claim.kind === 'saving'}
            >
              {claim.kind === 'saving'
                ? 'Copying…'
                : account.claimedAt || claim.kind === 'done'
                  ? 'Copy them again'
                  : `Copy my ${roster.filter((row) => row.tier).length} artists into my account`}
            </button>
          </>
        )}
        {claim.kind === 'done' && (
          <p className={styles.claimDone} role="status">
            Done — {claim.result.added} new follows.{' '}
            {TIER_ORDER.filter((tier) => claim.result.placed[tier] > 0)
              .map((tier) => `${TIER_LABELS[tier]}: ${claim.result.placed[tier]}`)
              .join(' · ') || 'Every tier already matched'}
            .
            {claim.result.kept.length > 0 &&
              ` Kept your own tier for ${claim.result.kept
                .map((slug) => nameOf.get(slug) ?? slug)
                .join(', ')}.`}{' '}
            <Link className={styles.inlineLink} href="/artists">
              See your rows →
            </Link>
          </p>
        )}
        {claim.kind === 'error' && (
          <p className={styles.statusError} role="alert">
            {claim.message}
          </p>
        )}
        <p className={`${styles.lead} ${styles.discoverNote}`}>
          <strong>Your own Discover picks</strong> (shown only on your owner
          view) come from{' '}
          {discoverAccount
            ? `the rows in ${discoverAccount} (your original site-wide tiers stand in while it has fewer than 3 artists in Heavy rotation and In the mix).`
            : 'your original site-wide tiers until you link an account — copying your groups links it.'}{' '}
          Everyone else sees the shared picks, drawn from the whole roster.
        </p>
        {account && account.email !== discoverAccount && (
          <button type="button" className={styles.claim} onClick={linkAccount}>
            Use {account.email} for my Discover picks
          </button>
        )}
        {linkError && (
          <p className={styles.statusError} role="alert">
            {linkError}
          </p>
        )}
      </section>

      <section aria-labelledby="tiers-heading">
        <h2 id="tiers-heading" className={styles.heading}>
          Site tier board
        </h2>
        <p className={styles.lead}>
          The original site-wide copy. It no longer shapes what visitors see,
          and it stands in for your own Discover picks only while no account
          is linked. Your own rows live in your account: change them with the
          Follow button on any artist page, or on My Taste Map.
        </p>
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
