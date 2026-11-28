'use client'

import { useEffect, useState } from 'react'
import { shuffle } from '@/lib/artists/mix'
import { getOwnerKey } from '@/lib/curation/ownerClient'
import { markPlayed } from '@/lib/discover/played'
import { useYouTubeQueue } from '@/components/play/useYouTubeQueue'
import { FollowButton } from '@/components/fans/FollowButton'
import { LikeButton } from '@/components/fans/LikeButton'
import { Icon } from '@/components/ui/Icon'
import styles from './ShufflePicks.module.css'

/** One past pick's song, as the shuffle plays it. */
export interface ShuffleTrack {
  videoId: string
  title: string
  artistName: string
  mbid: string
  /** The artist's page, once they have one: Follow follows the page. */
  slug?: string
}

/**
 * Shuffle through past picks (owner, Nov 28 2026: "a shuffle button that
 * plays through all the past picks in random order"): every pick's own
 * verified song, each artist once, in a fresh random order, through one
 * player — marked as played as each one starts, with ♥ and Follow for
 * whoever is playing. The order is fixed when the button is pressed, so
 * marks made while it plays never reshuffle what is coming.
 */
export function ShufflePicks({
  tracks,
  label,
  autoStart = false,
}: {
  tracks: readonly ShuffleTrack[]
  label: string
  /** Already asked for (the Discover row's button loads the picks first): play at once. */
  autoStart?: boolean
}) {
  const [order, setOrder] = useState<ShuffleTrack[] | null>(() => (autoStart ? shuffle(tracks, Math.random) : null))
  // Each shuffle is a fresh player, started from the top.
  const [round, setRound] = useState(0)
  const deal = () => {
    setOrder(shuffle(tracks, Math.random))
    setRound((count) => count + 1)
  }
  if (order === null) return <ShuffleStart count={tracks.length} label={label} onStart={deal} />
  return <ShufflePlayer key={round} order={order} onReshuffle={deal} />
}

function ShuffleStart({ count, label, onStart }: { count: number; label: string; onStart: () => void }) {
  if (count === 0) return null
  return (
    <button type="button" className={styles.start} onClick={onStart}>
      <Icon name="shuffle" size={15} /> {label}
    </button>
  )
}

function ShufflePlayer({ order, onReshuffle }: { order: ShuffleTrack[]; onReshuffle: () => void }) {
  const { mountRef, current, ended, broken, playAt, playAll } = useYouTubeQueue(
    order.map((track) => track.videoId),
    {
      // An artist counts as played when their song actually sounds — not
      // when Next skips past it, and not when a dead video is passed over.
      onPlaying: (videoId) => {
        const track = order.find((entry) => entry.videoId === videoId)
        if (track) markPlayed(track.mbid)
      },
    },
  )
  // Starts at once: the press on "Shuffle" is the listener asking to play.
  // Once per mount — React's development double mount included, whose
  // first player is torn down with its sound.
  useEffect(() => {
    playAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per mount, never on re-render
  }, [])

  const playing = current !== null ? order[current] : null
  return (
    <section className={styles.panel} aria-label="Shuffling past picks">
      <div className={styles.player}>
        <div ref={mountRef} className={styles.frame} />
      </div>
      <div className={styles.info}>
        <p className="visually-hidden" aria-live="polite">
          {playing ? `Now playing ${playing.title} by ${playing.artistName}` : ''}
        </p>
        <p className={styles.overline}>
          Shuffle · {current !== null ? `${current + 1} of ${order.length}` : `${order.length} songs`}
        </p>
        {playing ? (
          <>
            <p className={styles.artist}>{playing.artistName}</p>
            <div className={styles.songRow}>
              <span className={styles.song}>{playing.title}</span>
              <LikeButton
                variant="row"
                track={{ videoId: playing.videoId, title: playing.title, artistName: playing.artistName, mbid: playing.mbid }}
              />
            </div>
            {playing.slug ? (
              <FollowButton key={playing.mbid} artistName={playing.artistName} slug={playing.slug} inline />
            ) : (
              <FollowButton
                key={playing.mbid}
                artistName={playing.artistName}
                mbid={playing.mbid}
                videoId={playing.videoId}
                signInDest="/discover/past"
                inline
              />
            )}
          </>
        ) : (
          <p className={styles.song}>{broken ? 'The YouTube player didn’t load here.' : 'Starting…'}</p>
        )}
        <div className={styles.controls}>
          {ended ? (
            <span className={styles.note}>That’s every past pick.</span>
          ) : (
            <button
              type="button"
              className={styles.control}
              onClick={() => playAt(Math.min((current ?? -1) + 1, order.length - 1))}
              disabled={current === order.length - 1}
            >
              Next <Icon name="play" size={11} />
            </button>
          )}
          <button type="button" className={styles.control} onClick={onReshuffle}>
            <Icon name="shuffle" size={13} /> Reshuffle
          </button>
        </div>
      </div>
    </section>
  )
}

const VIDEO_ID = /^[\w-]{11}$/
const SLUG = /^[a-z0-9-]+$/

interface PastEntry {
  pick?: { name?: unknown; mbid?: unknown; song?: { videoId?: unknown; title?: unknown } | null }
  slug?: unknown
}

/** Past picks as the shuffle plays them: well-formed songs only (stored output outlives its code). */
export function shuffleTracksOf(entries: readonly PastEntry[]): ShuffleTrack[] {
  return entries.flatMap((entry): ShuffleTrack[] => {
    const pick = entry?.pick
    const song = pick?.song
    if (!pick || typeof pick.name !== 'string' || typeof pick.mbid !== 'string') return []
    if (!song || typeof song.videoId !== 'string' || !VIDEO_ID.test(song.videoId) || typeof song.title !== 'string') return []
    return [
      {
        videoId: song.videoId,
        title: song.title,
        artistName: pick.name,
        mbid: pick.mbid,
        ...(typeof entry.slug === 'string' && SLUG.test(entry.slug) ? { slug: entry.slug } : {}),
      },
    ]
  })
}

type PastState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; tracks: ShuffleTrack[] }

/**
 * The Discover row's shuffle (owner, Nov 28 2026: shuffle on the
 * Discover row too): every past pick, loaded only when asked for — the
 * list is hundreds of picks long, so the Artists page never fetches it
 * otherwise.
 */
export function ShuffleAllPast() {
  const [state, setState] = useState<PastState>({ status: 'idle' })

  async function load() {
    setState({ status: 'loading' })
    try {
      const key = getOwnerKey()
      const res = await fetch(key ? '/api/discover/past?own=1' : '/api/discover/past', {
        headers: key ? { 'x-owner-key': key } : undefined,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { artists?: PastEntry[] }
      const tracks = shuffleTracksOf(Array.isArray(body.artists) ? body.artists : [])
      setState(tracks.length > 0 ? { status: 'ready', tracks } : { status: 'error' })
    } catch {
      setState({ status: 'error' })
    }
  }

  if (state.status === 'ready') {
    return <ShufflePicks tracks={state.tracks} label={`Shuffle all ${state.tracks.length} past picks`} autoStart />
  }
  return (
    <button type="button" className={styles.start} onClick={load} disabled={state.status === 'loading'}>
      <Icon name="shuffle" size={15} />{' '}
      {state.status === 'loading'
        ? 'Gathering past picks…'
        : state.status === 'error'
          ? 'Past picks didn’t load — try again'
          : 'Shuffle all past picks'}
    </button>
  )
}
