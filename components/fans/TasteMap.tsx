'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
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
 * The fan's own taste map at /me: follows grouped by PERSONAL tier
 * (same vocabulary as the site's rotation levels), permanent first-fan
 * numbers, and an opt-in share link. Everything here is the fan's —
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

  async function setTier(slug: string, value: string) {
    const tier = isArtistTier(value) ? value : null
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, tier }),
      })
      if (!res.ok) return
      const body = (await res.json()) as { tiers?: Record<string, ArtistTier> }
      setProfile((current) =>
        current ? { ...current, tiers: body.tiers ?? {} } : current,
      )
    } catch (error) {
      console.error('Tier update failed:', error)
    }
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
        body: JSON.stringify({ slug, following: true }),
      })
      if (!res.ok) return
      const body = (await res.json()) as {
        follows?: string[]
        stamps?: Record<string, { number: number; since: string }>
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              follows: body.follows ?? current.follows,
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

  const groups: { tier: ArtistTier | null; label: string; slugs: string[] }[] =
    [
      ...TIER_ORDER.map((tier) => ({
        tier: tier as ArtistTier | null,
        label: TIER_LABELS[tier],
        slugs: profile.follows.filter(
          (slug) => profile.tiers?.[slug] === tier,
        ),
      })),
      {
        tier: null,
        label: 'Following',
        slugs: profile.follows.filter((slug) => !profile.tiers?.[slug]),
      },
    ]

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
        groups.map((group) => {
          const isRadar = group.tier === 'on-the-radar'
          const derived = isRadar ? radar.artists.length : 0
          if (group.slugs.length === 0 && !(isRadar && (radar.artists.length > 0 || radar.withoutIdentity > 0))) {
            return null
          }
          return (
              <section key={group.label} className={styles.group}>
                <h2 className={styles.groupTitle}>
                  {group.label}
                  {group.slugs.length + derived > 0 && (
                    <span className={styles.groupCount}>
                      {' '}
                      · {group.slugs.length + derived}
                    </span>
                  )}
                </h2>
                <ul className={styles.rows}>
                  {group.slugs.map((slug) => {
                    const stamp = profile.stamps?.[slug]
                    return (
                      <li key={slug} className={styles.row}>
                        <div className={styles.rowText}>
                          <Link className={styles.artist} href={`/${slug}`}>
                            {names.get(slug) ?? slug}
                          </Link>
                          {stamp && (
                            <span className={styles.stamp}>
                              Fan&nbsp;#{stamp.number} · since{' '}
                              {sinceLabel(stamp.since)}
                            </span>
                          )}
                        </div>
                        <select
                          className={styles.tierSelect}
                          value={profile.tiers?.[slug] ?? ''}
                          onChange={(event) =>
                            setTier(slug, event.target.value)
                          }
                          aria-label={`Your tier for ${names.get(slug) ?? slug}`}
                        >
                          <option value="">Following</option>
                          {TIER_ORDER.map((tier) => (
                            <option key={tier} value={tier}>
                              {TIER_LABELS[tier]}
                            </option>
                          ))}
                        </select>
                      </li>
                    )
                  })}
                </ul>
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
        })
      )}
    </div>
  )
}
