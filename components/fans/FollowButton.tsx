'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  DEFAULT_FOLLOW_TIER,
  TIER_HINTS,
  TIER_LABELS,
  TIER_ORDER,
  type ArtistTier,
} from '@/lib/tiers'
import styles from './FollowButton.module.css'

interface FollowButtonProps {
  slug: string
  artistName: string
}

interface FanProfile {
  signedIn: boolean
  email?: string
  follows: string[]
  tiers?: Record<string, ArtistTier>
  stamps?: Record<string, { number: number; since: string }>
}

/** "2026-07-16" → "July 2026". */
function sinceLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

type SignInState =
  | { status: 'closed' }
  | { status: 'open' }
  | { status: 'sending' }
  | { status: 'sent'; devLink?: string }

/** Keeps the chooser inside the screen's 16px gutter. */
const GUTTER = 16

/**
 * Follow an artist with the site-wide fan identity. Following means
 * choosing a row for them — Heavy rotation, In the mix or On the radar —
 * and the same control moves them later or unfollows. Signed-out
 * visitors get an inline magic-link form first.
 */
export function FollowButton({ slug, artistName }: FollowButtonProps) {
  const [profile, setProfile] = useState<FanProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [signIn, setSignIn] = useState<SignInState>({ status: 'closed' })
  const [email, setEmail] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const chooserRef = useRef<HTMLDivElement>(null)
  const chooserId = useId()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/fan')
        if (!res.ok) return
        const body = (await res.json()) as FanProfile
        if (!cancelled) setProfile(body)
      } catch {
        // Signed-out rendering is the safe default.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Outside click or Esc closes the chooser; Esc hands focus back.
  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Opened near the right edge of a phone, the chooser slides left
  // rather than pushing the page sideways.
  useLayoutEffect(() => {
    const chooser = chooserRef.current
    if (!open || !chooser) return
    const overflow =
      chooser.getBoundingClientRect().right - (window.innerWidth - GUTTER)
    chooser.style.transform = overflow > 0 ? `translateX(${-overflow}px)` : ''
    chooser
      .querySelector<HTMLButtonElement>('[aria-pressed="true"], button')
      ?.focus()
  }, [open])

  const following = profile?.follows.includes(slug) ?? false
  const tier = following ? (profile?.tiers?.[slug] ?? DEFAULT_FOLLOW_TIER) : null

  function onButton() {
    if (!profile) return
    if (!profile.signedIn) {
      setSignIn({ status: 'open' })
      return
    }
    setOpen((current) => !current)
  }

  async function save(body: { following: boolean; tier?: ArtistTier }) {
    setBusy(true)
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          // Moving a followed artist is a tier change; anything else is a
          // follow (with the chosen tier) or an unfollow.
          following && body.following && body.tier
            ? { slug, tier: body.tier }
            : { slug, ...body },
        ),
      })
      if (!res.ok) return
      const next = (await res.json()) as Partial<FanProfile>
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
      setOpen(false)
      buttonRef.current?.focus()
    } catch (error) {
      console.error('Follow update failed:', error)
    } finally {
      setBusy(false)
    }
  }

  async function requestLink(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setSignIn({ status: 'sending' })
    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), slug }),
      })
      const body = (await res.json()) as { sent?: boolean; devLink?: string }
      setSignIn(
        res.ok && body.sent
          ? { status: 'sent', devLink: body.devLink }
          : { status: 'open' },
      )
    } catch {
      setSignIn({ status: 'open' })
    }
  }

  if (!profile) return null

  const stamp = profile.stamps?.[slug]

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={following ? styles.following : styles.follow}
        onClick={onButton}
        disabled={busy || signIn.status === 'sending'}
        aria-expanded={profile.signedIn ? open : undefined}
        aria-controls={profile.signedIn && open ? chooserId : undefined}
        aria-label={
          tier ? `Following ${artistName}, in ${TIER_LABELS[tier]}. Change` : undefined
        }
      >
        {tier ? `♥ ${TIER_LABELS[tier]}` : '♡ Follow'}
        {profile.signedIn && (
          <span className={styles.caret} aria-hidden="true">
            ▾
          </span>
        )}
      </button>

      {open && profile.signedIn && (
        <div
          id={chooserId}
          ref={chooserRef}
          className={styles.chooser}
          role="group"
          aria-label={tier ? `Move ${artistName} to` : `Follow ${artistName} in`}
        >
          <p className={styles.chooserTitle}>
            {tier ? 'Move to' : `Follow ${artistName} in`}
          </p>
          {TIER_ORDER.map((choice) => (
            <button
              key={choice}
              type="button"
              className={styles.option}
              aria-pressed={choice === tier}
              disabled={busy}
              onClick={() =>
                choice === tier
                  ? setOpen(false)
                  : save({ following: true, tier: choice })
              }
            >
              <span className={styles.optionLabel}>
                {TIER_LABELS[choice]}
                {choice === tier && <span className={styles.check}> ✓</span>}
              </span>
              <span className={styles.optionHint}>{TIER_HINTS[choice]}</span>
            </button>
          ))}
          {tier && (
            <button
              type="button"
              className={styles.unfollow}
              disabled={busy}
              onClick={() => save({ following: false })}
            >
              Unfollow
            </button>
          )}
          <p className={styles.chooserNote}>
            Your rows show on the Artists page and filter your Feed.
          </p>
        </div>
      )}

      {following && stamp && (
        <p className={styles.stamp}>
          You&rsquo;re fan&nbsp;
          <span className={styles.stampNumber}>#{stamp.number}</span> —
          following since {sinceLabel(stamp.since)}
        </p>
      )}

      {signIn.status !== 'closed' && !profile.signedIn && (
        <div className={styles.signIn}>
          {signIn.status === 'sent' ? (
            <p className={styles.note}>
              Check your inbox — the link signs you in here.
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
                Follow {artistName} with just your email — a sign-in link,
                no password, no account to manage. Once you&rsquo;re in, pick
                the row they belong in: Heavy rotation, In the mix or On the
                radar.
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
        </div>
      )}
    </div>
  )
}
