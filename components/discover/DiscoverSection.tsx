'use client'

import { useEffect, useState } from 'react'
import { getOwnerKey } from '@/lib/curation/ownerClient'
import { PLAY_LABELS, type PlayLink, type ReadLink } from '@/lib/play/types'
import styles from './DiscoverSection.module.css'

interface DiscoverPick {
  name: string
  why: string
  knownFor: string
  /** False on sanitized legacy pools — the title is hidden then. */
  knownForVerified: boolean
  mbid: string
  play: PlayLink | null
  read: ReadLink
  listenHref: string
}

type DiscoverState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'warming' }
  | { status: 'ready'; picks: DiscoverPick[] }

const PAGE_SIZE = 3

/**
 * The API sanitizes legacy pools, but a CDN edge can hand this bundle
 * a pre-deploy cached payload for hours — normalize here too so a
 * search-URL listenHref or a missing read link can never render.
 */
function normalizePick(pick: Partial<DiscoverPick>): DiscoverPick[] {
  if (!pick.name || !pick.mbid) return []
  const mbUrl = `https://musicbrainz.org/artist/${pick.mbid}`
  return [
    {
      name: pick.name,
      why: pick.why ?? '',
      knownFor: pick.knownFor ?? '',
      knownForVerified: pick.knownForVerified === true,
      mbid: pick.mbid,
      play: pick.play ?? null,
      read: pick.read ?? { kind: 'musicbrainz', url: mbUrl },
      listenHref: pick.play?.url ?? pick.read?.url ?? mbUrl,
    },
  ]
}

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
          pool?: { picks: Partial<DiscoverPick>[] }
        }) => {
          if (body.status === 'ready' && body.pool) {
            setState({
              status: 'ready',
              picks: body.pool.picks.flatMap(normalizePick),
            })
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
                  {pick.play ? (
                    <a
                      className={styles.listen}
                      href={pick.play.url}
                      target="_blank"
                      rel="noreferrer"
                      title={PLAY_LABELS[pick.play.kind]}
                      aria-label={`${PLAY_LABELS[pick.play.kind]}: ${pick.knownFor} by ${pick.name}`}
                    >
                      ▶ {pick.knownFor}
                    </a>
                  ) : (
                    // No verified play destination — an honest read-about
                    // link, never a search URL that lands on garbage.
                    <a
                      className={styles.listen}
                      href={pick.read.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Read about ${pick.name}`}
                    >
                      {pick.knownForVerified
                        ? `Read about → ${pick.knownFor}`
                        : 'Read about →'}
                    </a>
                  )}
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
