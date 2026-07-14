'use client'

import { useEffect, useState } from 'react'
import { getOwnerKey } from '@/lib/curation/ownerClient'
import styles from './DiscoverSection.module.css'

interface DiscoverPick {
  name: string
  why: string
  knownFor: string
  mbid: string
  listenHref: string
}

type DiscoverState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'warming' }
  | { status: 'ready'; picks: DiscoverPick[] }

const PAGE_SIZE = 3

export function DiscoverSection() {
  const [state, setState] = useState<DiscoverState>({ status: 'loading' })
  const [offset, setOffset] = useState(0)
  const [ownerKey, setOwnerKeyState] = useState<string | null>(null)
  const [queuedMbids, setQueuedMbids] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/discover', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(
        (body: {
          status: 'ready' | 'warming' | 'disabled'
          pool?: { picks: DiscoverPick[] }
        }) => {
          if (body.status === 'ready' && body.pool) {
            setState({ status: 'ready', picks: body.pool.picks })
          } else if (body.status === 'warming') {
            setState({ status: 'warming' })
          } else {
            setState({ status: 'hidden' })
          }
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'hidden' })
      })
    return () => controller.abort()
  }, [])

  // Owner mode: show Follow buttons and which picks are already queued.
  useEffect(() => {
    const key = getOwnerKey()
    if (!key) return
    const controller = new AbortController()
    fetch('/api/follow', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((body: { entries: { mbid: string }[] }) => {
        setOwnerKeyState(key)
        setQueuedMbids(new Set(body.entries.map((entry) => entry.mbid)))
      })
      .catch(() => {
        if (!controller.signal.aborted) setOwnerKeyState(key)
      })
    return () => controller.abort()
  }, [])

  async function follow(pick: DiscoverPick) {
    if (!ownerKey) return
    setQueuedMbids((current) => new Set(current).add(pick.mbid))
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-key': ownerKey,
        },
        body: JSON.stringify({
          name: pick.name,
          mbid: pick.mbid,
          why: pick.why,
          knownFor: pick.knownFor,
          listenHref: pick.listenHref,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (error) {
      console.error('Follow failed:', error)
      setQueuedMbids((current) => {
        const next = new Set(current)
        next.delete(pick.mbid)
        return next
      })
    }
  }

  if (state.status === 'hidden') return null

  return (
    <section className={styles.section} aria-labelledby="discover-heading">
      <h2 id="discover-heading" className={styles.heading}>
        Discover
      </h2>
      <p className={styles.note}>
        Three new artists a day, picked by ear from the roster&apos;s taste —
        verified real on MusicBrainz, not on the roster (yet).
      </p>

      {state.status === 'loading' && (
        <p className={styles.quiet}>Listening for new artists…</p>
      )}
      {state.status === 'warming' && (
        <p className={styles.quiet}>
          Today&apos;s first picks are brewing — check back in a minute.
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <ul className={styles.grid}>
            {state.picks
              .slice(offset, offset + PAGE_SIZE)
              .map((pick) => (
                <li key={pick.mbid} className={styles.card}>
                  <span className={styles.name}>{pick.name}</span>
                  <span className={styles.why}>{pick.why}</span>
                  <a
                    className={styles.listen}
                    href={pick.listenHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Listen: search YouTube for ${pick.knownFor} by ${pick.name}`}
                  >
                    ▶ {pick.knownFor}
                  </a>
                  {ownerKey && (
                    <button
                      type="button"
                      className={styles.follow}
                      disabled={queuedMbids.has(pick.mbid)}
                      onClick={() => follow(pick)}
                    >
                      {queuedMbids.has(pick.mbid)
                        ? 'Following ✓'
                        : '+ Follow'}
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {state.picks.length > PAGE_SIZE && (
            <button
              type="button"
              className={styles.more}
              onClick={() =>
                setOffset((value) =>
                  value + PAGE_SIZE >= state.picks.length
                    ? 0
                    : value + PAGE_SIZE,
                )
              }
            >
              Show me 3 more
            </button>
          )}
        </>
      )}
    </section>
  )
}
