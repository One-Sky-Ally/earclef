'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  DEFAULT_FOLLOW_TIER,
  TIER_LABELS,
  TIER_ORDER,
  isArtistTier,
  type ArtistTier,
} from '@/lib/tiers'
import { deriveRadar } from '@/lib/fans/radar'
import { useLikes } from '@/components/fans/LikesProvider'
import { RadarFromLikes } from '@/components/fans/RadarFromLikes'
import styles from './TasteMap.module.css'

interface RosterName {
  slug: string
  name: string
}

/** MusicBrainz id → roster page, for artists the likes surface. */
export type RosterByMbid = Record<string, { slug: string; name: string }>

interface FanProfile {
  signedIn: boolean
  email?: string
  follows: string[]
  tiers?: Record<string, ArtistTier>
  stamps?: Record<string, { number: number; since: string }>
  share?: { enabled: boolean; token?: string; displayName?: string }
}

type FollowStatus =
  | { kind: 'moved'; slug: string; tier: ArtistTier }
  | { kind: 'unfollowed'; slug: string; tier: ArtistTier }
  | { kind: 'error'; message: string }

/** The dropdown's last option: not a row, the way out. */
const UNFOLLOW = 'unfollow'

type SignInState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; devLink?: string }

/** "2026-07-16" → "Jul 2026". */
function sinceLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/**
 * The fan's own taste map at /me: a Following list of every artist they
 * follow, grouped by their OWN rows (the same rows the Artists page
 * shows them), A–Z, with a menu on each to move it or unfollow (Undo
 * available) — a board to sort quickly, for every signed-in listener.
 * Plus permanent first-fan numbers and an opt-in share link. Everything here is the fan's —
 * separate from the owner Tier Board.
 */
export function TasteMap({
  roster,
  rosterByMbid,
}: {
  roster: RosterName[]
  rosterByMbid: RosterByMbid
}) {
  const [profile, setProfile] = useState<FanProfile | null>(null)
  const [email, setEmail] = useState('')
  const [signIn, setSignIn] = useState<SignInState>({ status: 'idle' })
  const [nameDraft, setNameDraft] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // The last change on the Following list, with Undo for an unfollow.
  const [status, setStatus] = useState<FollowStatus | null>(null)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const { likes, radarDismissed } = useLikes()

  const names = new Map(roster.map((entry) => [entry.slug, entry.name]))

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/fan')
        if (!res.ok) return
        const body = (await res.json()) as FanProfile
        if (!cancelled) {
          setProfile(body)
          setNameDraft(body.share?.displayName ?? '')
        }
      } catch {
        // Signed-out rendering is the safe default.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function requestLink(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setSignIn({ status: 'sending' })
    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), dest: '/me' }),
      })
      const body = (await res.json()) as { sent?: boolean; devLink?: string }
      setSignIn(
        res.ok && body.sent
          ? { status: 'sent', devLink: body.devLink }
          : { status: 'idle' },
      )
    } catch {
      setSignIn({ status: 'idle' })
    }
  }

  function markSaving(slug: string, on: boolean) {
    setSaving((current) => {
      const next = new Set(current)
      if (on) next.add(slug)
      else next.delete(slug)
      return next
    })
  }

  async function postFan(body: unknown): Promise<Partial<FanProfile> | null> {
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.ok ? ((await res.json()) as Partial<FanProfile>) : null
    } catch {
      return null
    }
  }

  function applyProfile(next: Partial<FanProfile>) {
    setProfile((current) =>
      current
        ? {
            ...current,
            follows: next.follows ?? current.follows,
            tiers: next.tiers ?? current.tiers,
            stamps: next.stamps ?? current.stamps,
          }
        : current,
    )
  }

  /**
   * The row dropdown: a tier moves the artist (shown at once, put back
   * if the save fails); "Unfollow" removes them, with Undo.
   */
  async function onRowChange(slug: string, value: string) {
    if (!profile) return
    const previous = profile.tiers?.[slug] ?? DEFAULT_FOLLOW_TIER
    const name = names.get(slug) ?? slug
    markSaving(slug, true)
    if (value === UNFOLLOW) {
      const body = await postFan({ slug, following: false })
      markSaving(slug, false)
      if (!body) {
        setStatus({ kind: 'error', message: `Couldn’t unfollow ${name} — please try again.` })
        return
      }
      applyProfile(body)
      setStatus({ kind: 'unfollowed', slug, tier: previous })
      return
    }
    if (!isArtistTier(value) || value === previous) {
      markSaving(slug, false)
      return
    }
    const tier = value
    setProfile((current) =>
      current ? { ...current, tiers: { ...current.tiers, [slug]: tier } } : current,
    )
    const body = await postFan({ slug, tier })
    markSaving(slug, false)
    if (!body) {
      setProfile((current) =>
        current ? { ...current, tiers: { ...current.tiers, [slug]: previous } } : current,
      )
      setStatus({ kind: 'error', message: `Couldn’t move ${name} — please try again.` })
      return
    }
    applyProfile(body)
    setStatus({ kind: 'moved', slug, tier })
  }

  /** Undo an unfollow: same artist, same row, same fan number. */
  async function undoUnfollow(slug: string, tier: ArtistTier) {
    markSaving(slug, true)
    const body = await postFan({ slug, following: true, tier })
    markSaving(slug, false)
    if (!body) {
      setStatus({ kind: 'error', message: 'Couldn’t undo — follow them again from their page.' })
      return
    }
    applyProfile(body)
    setStatus({ kind: 'moved', slug, tier })
  }

  /**
   * Follow an artist the radar surfaced. The response carries the new
   * follow list and its fan stamps, so the row moves out of the derived
   * radar and into the map proper on the next render.
   */
  async function followFromRadar(slug: string) {
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // An artist found through likes starts where they came from.
        body: JSON.stringify({ slug, following: true, tier: 'on-the-radar' }),
      })
      if (!res.ok) return
      const body = (await res.json()) as {
        follows?: string[]
        tiers?: Record<string, ArtistTier>
        stamps?: Record<string, { number: number; since: string }>
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              follows: body.follows ?? current.follows,
              tiers: body.tiers ?? current.tiers,
              stamps: body.stamps ?? current.stamps,
            }
          : current,
      )
    } catch (error) {
      console.error('Follow from radar failed:', error)
    }
  }

  async function updateShare(enabled: boolean) {
    setShareBusy(true)
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share: { enabled, displayName: nameDraft },
        }),
      })
      if (!res.ok) return
      const body = (await res.json()) as { share?: FanProfile['share'] }
      setProfile((current) =>
        current ? { ...current, share: body.share } : current,
      )
      setNameDraft(body.share?.displayName ?? '')
      setCopied(false)
    } catch (error) {
      console.error('Share update failed:', error)
    } finally {
      setShareBusy(false)
    }
  }

  async function signOut() {
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
      window.location.reload()
    } catch (error) {
      console.error('Sign-out failed:', error)
    }
  }

  async function copyShareLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (!profile) {
    return (
      <div className={styles.shimmerBlock} aria-hidden="true">
        <span className={styles.shimmer} />
        <span className={`${styles.shimmer} ${styles.shimmerShort}`} />
      </div>
    )
  }

  if (!profile.signedIn) {
    return (
      <section className={styles.signIn}>
        {signIn.status === 'sent' ? (
          <p className={styles.note}>
            Check your inbox — the link brings you back here, signed in.
            {signIn.devLink && (
              <>
                {' '}
                <a className={styles.devLink} href={signIn.devLink}>
                  (dev: sign in now)
                </a>
              </>
            )}
          </p>
        ) : (
          <form className={styles.form} onSubmit={requestLink}>
            <p className={styles.note}>
              Your taste map lives behind your email — a sign-in link, no
              password, no account to manage.
            </p>
            <div className={styles.formRow}>
              <input
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-label="Email for sign-in link"
              />
              <button
                className={styles.submit}
                type="submit"
                disabled={signIn.status === 'sending'}
              >
                {signIn.status === 'sending' ? 'Sending…' : 'Send link'}
              </button>
            </div>
          </form>
        )}
      </section>
    )
  }

  // Every follow has a tier — the server fills in "In the mix" for any
  // the fan never placed.
  const byName = (a: string, b: string) =>
    (names.get(a) ?? a).localeCompare(names.get(b) ?? b)
  const groups = TIER_ORDER.map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    slugs: profile.follows
      .filter((slug) => (profile.tiers?.[slug] ?? DEFAULT_FOLLOW_TIER) === tier)
      .sort(byName),
  }))
  const statusName = (slug: string) => names.get(slug) ?? slug

  const radar = deriveRadar({
    likes,
    dismissed: radarDismissed,
    rosterByMbid,
    followedSlugs: profile.follows,
  })

  const shareUrl = profile.share?.token
    ? `${window.location.origin}/fan/${profile.share.token}`
    : null

  return (
    <div className={styles.map}>
      <div className={styles.accountRow}>
        <span className={styles.email}>{profile.email}</span>
        <button type="button" className={styles.signOut} onClick={signOut}>
          Sign out
        </button>
      </div>

      <section className={styles.shareCard}>
        <h2 className={styles.shareTitle}>Share your taste map</h2>
        <p className={styles.shareNote}>
          Sharing creates a read-only public page — your follows, tiers, and
          fan numbers. Never your email. Turn it off anytime and the link
          dies instantly.
        </p>
        <div className={styles.shareControls}>
          <input
            className={styles.input}
            type="text"
            placeholder="Display name (optional)"
            maxLength={40}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            aria-label="Display name shown on your shared page"
          />
          <button
            type="button"
            className={
              profile.share?.enabled ? styles.shareOn : styles.shareOff
            }
            onClick={() => updateShare(!profile.share?.enabled)}
            disabled={shareBusy}
          >
            {shareBusy
              ? '…'
              : profile.share?.enabled
                ? 'Sharing on — turn off'
                : 'Turn sharing on'}
          </button>
        </div>
        {shareUrl && (
          <p className={styles.shareLinkRow}>
            <Link className={styles.shareLink} href={shareUrl}>
              {shareUrl}
            </Link>
            <button
              type="button"
              className={styles.copy}
              onClick={() => copyShareLink(shareUrl)}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </p>
        )}
      </section>

      {profile.follows.length === 0 && !(radar.artists.length > 0 || radar.withoutIdentity > 0) ? (
        <p className={styles.empty}>
          You&rsquo;re not following anyone yet. Find an artist and tap
          ♡&nbsp;Follow — your map starts there.{' '}
          <Link className={styles.emptyLink} href="/artists">
            Browse the roster →
          </Link>
        </p>
      ) : (
        <section className={styles.following} aria-labelledby="following-heading">
          <div className={styles.followingIntro}>
            <h2 id="following-heading" className={styles.followingTitle}>
              Following
              <span className={styles.groupCount}> · {profile.follows.length}</span>
            </h2>
            <p className={styles.followingHint}>
              Every artist you follow, by row. Use the menu on each one to move it
              or unfollow — changes save as you go.
            </p>
          </div>
          {/* Stays in view while you work down the list. */}
          <div className={styles.followingHead}>
            <nav className={styles.jump} aria-label="Jump to a row">
              {groups.map((group) => (
                <a key={group.tier} className={styles.jumpLink} href={`#row-${group.tier}`}>
                  {group.label} <span className={styles.jumpCount}>{group.slugs.length}</span>
                </a>
              ))}
            </nav>
            <p className={styles.status} role="status" aria-live="polite">
              {status?.kind === 'moved' &&
                `Moved ${statusName(status.slug)} to ${TIER_LABELS[status.tier]}.`}
              {status?.kind === 'unfollowed' && (
                <>
                  Unfollowed {statusName(status.slug)}.{' '}
                  <button
                    type="button"
                    className={styles.undo}
                    onClick={() => undoUnfollow(status.slug, status.tier)}
                    disabled={saving.has(status.slug)}
                  >
                    Undo
                  </button>
                </>
              )}
              {status?.kind === 'error' && (
                <span className={styles.statusError}>{status.message}</span>
              )}
            </p>
          </div>

          {groups.map((group) => {
            const isRadar = group.tier === 'on-the-radar'
            const derived = isRadar ? radar.artists.length : 0
            const showRadar = isRadar && (radar.artists.length > 0 || radar.withoutIdentity > 0)
            return (
              <section
                key={group.tier}
                id={`row-${group.tier}`}
                className={styles.group}
                aria-labelledby={`row-${group.tier}-heading`}
              >
                <h3 id={`row-${group.tier}-heading`} className={styles.groupTitle}>
                  {group.label}
                  <span className={styles.groupCount}> · {group.slugs.length + derived}</span>
                </h3>
                {group.slugs.length === 0 && !showRadar ? (
                  <p className={styles.groupEmpty}>Nobody here yet.</p>
                ) : (
                  <ul className={styles.rows}>
                    {group.slugs.map((slug) => {
                      const stamp = profile.stamps?.[slug]
                      const name = names.get(slug) ?? slug
                      return (
                        <li key={slug} className={styles.row}>
                          <div className={styles.rowText}>
                            <Link className={styles.artist} href={`/${slug}`}>
                              {name}
                            </Link>
                            {stamp && (
                              <span className={styles.stamp}>
                                Fan&nbsp;#{stamp.number} · since {sinceLabel(stamp.since)}
                              </span>
                            )}
                          </div>
                          <select
                            className={styles.tierSelect}
                            value={profile.tiers?.[slug] ?? DEFAULT_FOLLOW_TIER}
                            onChange={(event) => onRowChange(slug, event.target.value)}
                            disabled={saving.has(slug)}
                            aria-label={`Row for ${name}`}
                          >
                            {TIER_ORDER.map((tier) => (
                              <option key={tier} value={tier}>
                                {TIER_LABELS[tier]}
                              </option>
                            ))}
                            <option value={UNFOLLOW}>Unfollow</option>
                          </select>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {isRadar && (
                  <RadarFromLikes
                    artists={radar.artists}
                    withoutIdentity={radar.withoutIdentity}
                    dismissedMbids={radar.dismissedMbids}
                    onFollow={followFromRadar}
                  />
                )}
              </section>
            )
          })}
        </section>
      )}
    </div>
  )
}
