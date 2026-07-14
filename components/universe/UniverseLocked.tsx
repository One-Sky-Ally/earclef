'use client'

import { useState } from 'react'
import type { MembershipContent } from '@/lib/types'
import type { UniverseLockedResponse } from '@/lib/membership/types'
import { KIND_LABELS, formatPostDate } from '@/components/universe/postMeta'
import styles from './Universe.module.css'

interface UniverseLockedProps {
  slug: string
  membership: MembershipContent
  data: UniverseLockedResponse
}

type SignInState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; devLink?: string }
  | { status: 'error'; message: string }

export function UniverseLocked({ slug, membership, data }: UniverseLockedProps) {
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [signIn, setSignIn] = useState<SignInState>({ status: 'idle' })

  async function join() {
    setJoining(true)
    setJoinError(null)
    try {
      const res = await fetch('/api/membership/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const body = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      window.location.assign(body.url)
    } catch (error) {
      setJoinError((error as Error).message)
      setJoining(false)
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
      const body = (await res.json()) as { sent?: boolean; devLink?: string; error?: string }
      if (!res.ok || !body.sent) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setSignIn({ status: 'sent', devLink: body.devLink })
    } catch (error) {
      setSignIn({ status: 'error', message: (error as Error).message })
    }
  }

  return (
    <div className={styles.locked}>
      <p className={styles.teaserCopy}>{membership.teaser}</p>

      {data.signedInAs && (
        <p className={styles.quiet}>
          Signed in as {data.signedInAs} — this email has no active year here.
        </p>
      )}

      {data.teasers.length > 0 ? (
        <ul className={styles.teaserGrid}>
          {data.teasers.map((teaser) => (
            <li key={teaser.id} className={styles.teaserCard}>
              <span className={styles.lockMark} aria-hidden="true">
                ⚿
              </span>
              <span className={styles.teaserKind}>{KIND_LABELS[teaser.kind]}</span>
              <span className={styles.teaserTitle}>{teaser.title}</span>
              <span className={styles.teaserDate}>
                {formatPostDate(teaser.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>The first drop is being prepared.</p>
      )}

      <div className={styles.joinCard}>
        <p className={styles.joinPrice}>
          ${membership.priceUsd}
          <span className={styles.joinPriceUnit}> · one year</span>
        </p>
        <ul className={styles.joinPoints}>
          <li>No auto-renewal — it simply ends. No card kept on file.</li>
          <li>One reminder email near the end; renewing is one click, always your choice.</li>
          <li>Every dollar goes to the artist.</li>
        </ul>
        <button
          type="button"
          className={styles.joinButton}
          onClick={join}
          disabled={joining || !data.checkoutReady}
        >
          {joining ? 'Opening checkout…' : `Join — $${membership.priceUsd}/year`}
        </button>
        {!data.checkoutReady && (
          <p className={styles.quiet}>
            Payments aren&rsquo;t switched on yet — check back soon.
          </p>
        )}
        {joinError && <p className={styles.error}>{joinError}</p>}

        <div className={styles.signIn}>
          <p className={styles.signInLabel}>Already a member?</p>
          {signIn.status === 'sent' ? (
            <p className={styles.quiet}>
              Check your inbox — the link signs you in and expires in 15 minutes.
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
            <form className={styles.signInForm} onSubmit={requestLink}>
              <input
                className={styles.signInInput}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!data.signInReady}
                aria-label="Email for sign-in link"
              />
              <button
                type="submit"
                className={styles.signInButton}
                disabled={signIn.status === 'sending' || !data.signInReady}
              >
                {signIn.status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          )}
          {!data.signInReady && (
            <p className={styles.quiet}>Sign-in isn&rsquo;t switched on yet.</p>
          )}
          {signIn.status === 'error' && (
            <p className={styles.error}>{signIn.message}</p>
          )}
        </div>
      </div>
    </div>
  )
}
