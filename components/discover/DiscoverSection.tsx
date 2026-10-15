'use client'

import { useEffect, useState } from 'react'
import { YouTubeEmbed } from '@/components/YouTubeEmbed'
import { LikeButton } from '@/components/fans/LikeButton'
import { getOwnerKey } from '@/lib/curation/ownerClient'
import { PLAY_LABELS, type PlayLink, type ReadLink } from '@/lib/play/types'
import { ScrollRow } from '@/components/ui/ScrollRow'
import styles from './DiscoverSection.module.css'

type SongKind = 'official-video' | 'audio' | 'video'

/** The verified song the card plays (lib/discover/song.ts), as rendered. */
interface DiscoverSong {
  videoId: string
  title: string
  kind: SongKind
}

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
  song: DiscoverSong | null
  /** The artist's own Bandcamp page, kept under the player (owner, Oct 11 2026). */
  bandcamp: string | null
  /** For a signed-in listener: the artists in their rows this pick connects to. */
  because?: string[]
}

const SONG_KIND_LABELS: Record<SongKind, string> = {
  'official-video': 'Official video',
  audio: 'Audio',
  video: 'Video',
}

const VIDEO_ID = /^[\w-]{11}$/

/**
 * Render-time guard over stored output (standing lesson 2: stored
 * pools outlive their generators): a song plays only with a well-formed
 * video id and a title; anything else is no song.
 */
function songOf(song: Partial<DiscoverSong> | null | undefined): DiscoverSong | null {
  if (!song || typeof song.videoId !== 'string' || !VIDEO_ID.test(song.videoId)) return null
  if (typeof song.title !== 'string' || song.title === '') return null
  const kind: SongKind =
    song.kind === 'official-video' || song.kind === 'audio' ? song.kind : 'video'
  return { videoId: song.videoId, title: song.title, kind }
}

/** Only a real Bandcamp page earns the link under the player. */
function bandcampOf(pick: Partial<DiscoverPick>): string | null {
  const candidate =
    typeof pick.bandcamp === 'string'
      ? pick.bandcamp
      : pick.play?.kind === 'bandcamp'
        ? pick.play.url
        : null
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const host = url.hostname.replace(/^www\./, '')
    return url.protocol === 'https:' && (host === 'bandcamp.com' || host.endsWith('.bandcamp.com'))
      ? candidate
      : null
  } catch {
    return null
  }
}

type DiscoverState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'warming' }
  /**
   * own: the owner's own picks (owner view only); mine: a signed-in
   * listener's picks matched to their rows, `matched` of them, then
   * shared ones; shared: the same picks everyone sees.
   */
  | {
      status: 'ready'
      picks: DiscoverPick[]
      mode: 'own' | 'mine' | 'shared'
      matched?: number
      /** Shared picks shown again because the stock ran out (or is not in yet). */
      archive?: boolean
      /** Owner's view: more sets ready after this one. */
      ready?: number
    }

interface PoolBody {
  status: 'ready' | 'warming' | 'disabled' | 'none'
  pool?: { picks: Partial<DiscoverPick>[] }
  archive?: boolean
  ready?: number
}

interface MineBody {
  status: 'ready' | 'visitor' | 'no-follows' | 'none' | 'no-matches'
  matched?: number
  picks?: Partial<DiscoverPick>[]
}


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
      song: songOf(pick.song),
      bandcamp: bandcampOf(pick),
      because: Array.isArray(pick.because)
        ? pick.because.filter((name): name is string => typeof name === 'string')
        : undefined,
    },
  ]
}

export function DiscoverSection() {
  const [state, setState] = useState<DiscoverState>({ status: 'loading' })
  const [ownerKey, setOwnerKeyState] = useState<string | null>(null)
  const [queuedMbids, setQueuedMbids] = useState<Set<string>>(new Set())

  // The owner's view shows the owner's own picks (from their rows) when
  // they exist; a signed-in listener gets the week's shared picks that
  // connect to their rows; everyone else — and anyone with no match —
  // gets today's shared picks, drawn from the whole roster.
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    const load = <T,>(url: string, init?: RequestInit) =>
      fetch(url, { ...init, signal }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<T>
      })
    ;(async () => {
      const key = getOwnerKey()
      if (key) {
        try {
          const own = await load<PoolBody>('/api/discover/owner', {
            headers: { 'x-owner-key': key },
          })
          if (own.status === 'ready' && own.pool) {
            setState({
              status: 'ready',
              picks: own.pool.picks.flatMap(normalizePick),
              mode: 'own',
              ready: own.ready ?? 0,
            })
            return
          }
        } catch {
          // Fall through to the listener's or the shared picks.
        }
      }
      try {
        const mine = await load<MineBody>('/api/discover/mine')
        if (mine.status === 'ready' && mine.picks && (mine.matched ?? 0) > 0) {
          setState({
            status: 'ready',
            picks: mine.picks.flatMap(normalizePick),
            mode: 'mine',
            matched: mine.matched,
          })
          return
        }
      } catch {
        // Fall through to the shared picks.
      }
      try {
        const body = await load<PoolBody>('/api/discover')
        if (body.status === 'ready' && body.pool) {
          setState({
            status: 'ready',
            picks: body.pool.picks.flatMap(normalizePick),
            mode: 'shared',
            archive: body.archive === true,
          })
        } else if (body.status === 'warming') {
          setState({ status: 'warming' })
        } else {
          setState({ status: 'hidden' })
        }
      } catch {
        if (!signal.aborted) setState({ status: 'hidden' })
      }
    })()
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

  // Said plainly: whose taste the picks come from, and how fresh they are.
  let note = ''
  if (state.status === 'ready' && state.mode === 'own') {
    const more =
      (state.ready ?? 0) > 0
        ? `${state.ready} more ${state.ready === 1 ? 'set' : 'sets'} ready`
        : 'the last set until the next refresh'
    note = `Your own picks — a fresh set each day you visit, from your rows (${more}). Artists not on Ear Clef yet, verified real on MusicBrainz. Only you see these; visitors get the shared picks.`
  } else if (state.status === 'ready' && state.mode === 'mine') {
    note = `${state.matched} ${state.matched === 1 ? 'pick connects' : 'picks connect'} to artists in your rows — from the last two weeks of shared picks, artists not on Ear Clef yet and verified real on MusicBrainz${(state.matched ?? 0) < state.picks.length ? '; the rest are today’s picks for everyone' : ''}.`
  } else if (state.status === 'ready' && state.archive) {
    note =
      'From the archive — picks from earlier days, shown again until fresh ones arrive. Artists not on Ear Clef yet, verified real on MusicBrainz.'
  } else {
    note =
      'Today’s picks for everyone — a new set each day, artists not on Ear Clef yet, chosen from the whole roster and verified real on MusicBrainz. Not personalised yet.'
  }

  if (state.status !== 'ready') {
    return (
      <section className={styles.section} aria-labelledby="discover-heading">
        <h2 id="discover-heading" className={styles.heading}>
          Discover new artists
        </h2>
        <p className={styles.quiet}>
          {state.status === 'loading'
            ? 'Listening for new artists…'
            : 'New picks arrive with the next refresh.'}
        </p>
      </section>
    )
  }

  return (
    <div className={styles.section}>
      <ScrollRow
        id="discover"
        title="Discover new artists"
        note={note}
        perView={3}
        items={state.picks.map((pick) => ({
          key: pick.mbid,
          node: (
            <div className={styles.card}>
              <span className={styles.name}>{pick.name}</span>
              {pick.because && pick.because.length > 0 && (
                <span className={styles.because}>
                  Because you follow {pick.because.join(' and ')}
                </span>
              )}
              <span className={styles.why}>{pick.why}</span>
              {pick.song ? (
                // A verified song plays here, on the site. The Bandcamp
                // page stays as a small link so listeners can buy from
                // the artist directly (owner, Oct 11).
                <div className={styles.song}>
                  <YouTubeEmbed
                    video={{ youtubeId: pick.song.videoId, title: pick.song.title }}
                  />
                  <div className={styles.songMeta}>
                    <span className={styles.songKind}>
                      {SONG_KIND_LABELS[pick.song.kind]}
                    </span>
                    <LikeButton
                      variant="row"
                      track={{
                        videoId: pick.song.videoId,
                        title: pick.song.title,
                        artistName: pick.name,
                        mbid: pick.mbid,
                      }}
                    />
                    {pick.bandcamp && (
                      <a
                        className={styles.listen}
                        href={pick.bandcamp}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${pick.name} on Bandcamp`}
                      >
                        Bandcamp →
                      </a>
                    )}
                  </div>
                </div>
              ) : pick.play ? (
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
                  {queuedMbids.has(pick.mbid) ? 'Following ✓' : '+ Follow'}
                </button>
              )}
            </div>
          ),
        }))}
      />
    </div>
  )
}
