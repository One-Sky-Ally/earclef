'use client'

import { useState } from 'react'
import type { UniverseMemberResponse } from '@/lib/membership/types'
import { formatPostDate } from '@/components/universe/postMeta'
import { UniversePostCard } from '@/components/universe/UniversePostCard'
import styles from './Universe.module.css'

interface UniverseFeedProps {
  slug: string
  artistName: string
  data: UniverseMemberResponse
  onSignedOut: () => void
}

export function UniverseFeed({
  slug,
  artistName,
  data,
  onSignedOut,
}: UniverseFeedProps) {
  const [renewing, setRenewing] = useState(false)
  const [renewError, setRenewError] = useState<string | null>(null)

  async function renew() {
    setRenewing(true)
    setRenewError(null)
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
      setRenewError((error as Error).message)
      setRenewing(false)
    }
  }

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' })
    onSignedOut()
  }

  return (
    <div>
      <div className={styles.memberBar}>
        <p className={styles.memberStatus}>
          {data.member.source === 'comp' ? 'Guest of the artist' : 'Member'}{' '}
          through {formatPostDate(data.member.expiresAt)} — nothing
          auto-renews.
        </p>
        <div className={styles.memberActions}>
          {/* Always offered: years stack from the current expiry, so
              renewing early never costs a day. */}
          <button
            type="button"
            className={styles.renewButton}
            onClick={renew}
            disabled={renewing}
          >
            {renewing ? 'Opening checkout…' : 'Add another year'}
          </button>
          <button
            type="button"
            className={styles.signOutButton}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </div>
      {renewError && <p className={styles.error}>{renewError}</p>}

      {data.posts.length === 0 ? (
        <p className={styles.quiet}>
          Nothing posted yet — the first drop from {artistName} is on its way.
        </p>
      ) : (
        <ul className={styles.feed}>
          {data.posts.map((post) => (
            <UniversePostCard key={post.id} slug={slug} post={post} />
          ))}
        </ul>
      )}
    </div>
  )
}
