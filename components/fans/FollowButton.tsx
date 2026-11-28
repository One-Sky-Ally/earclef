'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { artistKey } from '@/lib/fans/artistKeys'
import type { SignInDestination } from '@/lib/membership/signInDest'
import {
  DEFAULT_FOLLOW_TIER,
  TIER_HINTS,
  TIER_LABELS,
  TIER_ORDER,
  type ArtistTier,
} from '@/lib/tiers'
import { mergeFanProfile, useFanProfile, type FanProfile } from './useFanProfile'
import styles from './FollowButton.module.css'

interface FollowButtonProps {
  artistName: string
  /** A roster artist's page slug. */
  slug?: string
  /**
   * An artist with no page yet (Discover, Nov 28 2026): followed by
   * their MusicBrainz id, opening on their archive card.
   */
  mbid?: string
  /** A verified video of theirs, for their card in the rows. */
  videoId?: string
  /** Where sign-in returns to when there is no page to return to. */
  signInDest?: SignInDestination
  /** Inside a card in a sideways-scrolling row: the row chooser opens in the card. */
  inline?: boolean
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
export function FollowButton({
  artistName,
  slug,
  mbid,
  videoId,
  signInDest,
  inline = false,
}: FollowButtonProps) {
  const fan = useFanProfile()
  const profile: FanProfile | null = fan.status === 'ready' ? fan.profile : null
  // The follows-list key: the page's slug, or `mb:<id>` for a page-less artist.
  const key = slug ?? (mbid ? artistKey(mbid) : null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [signIn, setSignIn] = useState<SignInState>({ status: 'closed' })
  const [email, setEmail] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const chooserRef = useRef<HTMLDivElement>(null)
  const chooserId = useId()

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
    chooser.style.transform = !inline && overflow > 0 ? `translateX(${-overflow}px)` : ''
    chooser
      .querySelector<HTMLButtonElement>('[aria-pressed="true"], button')
      ?.focus()
  }, [open, inline])

  const following = key ? (profile?.follows.includes(key) ?? false) : false
  const tier = following && key ? (profile?.tiers?.[key] ?? DEFAULT_FOLLOW_TIER) : null

  function onButton() {
    if (!profile) return
    if (!profile.signedIn) {
      setSignIn({ status: 'open' })
      return
    }
    setOpen((current) => !current)
  }

  async function save(body: { following: boolean; tier?: ArtistTier }) {
    if (!key) return
    setBusy(true)
    // A page-less artist's follow carries who they are.
    const who = slug ? {} : { artist: { name: artistName, ...(videoId && { videoId }) } }
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          // Moving a followed artist is a tier change; anything else is a
          // follow (with the chosen tier) or an unfollow.
          following && body.following && body.tier
            ? { slug: key, tier: body.tier }
            : { slug: key, ...body, ...who },
        ),
      })
      if (!res.ok) return
      mergeFanProfile((await res.json()) as Partial<FanProfile>)
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
        body: JSON.stringify(
          slug ? { email: email.trim(), slug } : { email: email.trim(), dest: signInDest ?? '/me' },
        ),
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

  if (!profile || !key) return null

  const stamp = slug ? profile.stamps?.[slug] : undefined

  return (
    <div className={`${styles.wrap} ${inline ? styles.inline : ''}`} ref={wrapRef}>
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
            {slug
              ? 'Your rows show on the Artists page and filter your Feed.'
              : 'Your rows show on the Artists page and My Taste Map.'}
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
