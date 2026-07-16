'use client'

import { useEffect, useState } from 'react'
import styles from './FollowButton.module.css'

interface FollowButtonProps {
  slug: string
  artistName: string
}

interface FanProfile {
  signedIn: boolean
  email?: string
  follows: string[]
}

type SignInState =
  | { status: 'closed' }
  | { status: 'open' }
  | { status: 'sending' }
  | { status: 'sent'; devLink?: string }

/**
 * Follow an artist with the site-wide fan identity. Signed-out visitors
 * get an inline magic-link form; signed-in fans get a one-click toggle
 * that feeds the /feed "Following" filter.
 */
export function FollowButton({ slug, artistName }: FollowButtonProps) {
  const [profile, setProfile] = useState<FanProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [signIn, setSignIn] = useState<SignInState>({ status: 'closed' })
  const [email, setEmail] = useState('')

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

  const following = profile?.follows.includes(slug) ?? false

  async function toggle() {
    if (!profile) return
    if (!profile.signedIn) {
      setSignIn({ status: 'open' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, following: !following }),
      })
      if (res.ok) setProfile((await res.json()) as FanProfile)
    } catch (error) {
      console.error('Follow toggle failed:', error)
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

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={following ? styles.following : styles.follow}
        onClick={toggle}
        disabled={busy || signIn.status === 'sending'}
      >
        {following ? '♥ Following' : '♡ Follow'}
      </button>

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
                no password, no account to manage.
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
