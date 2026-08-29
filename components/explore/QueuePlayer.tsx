'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { PoolArtist } from '@/lib/explore/panelData'
import { isDemotedArtist } from '@/lib/explore/genreFamilies'
import {
  planAppend,
  releasePlan,
  type AppendPlan,
} from '@/lib/explore/queueOrder'
import type { RosterByMbid } from './CountryPanel'
import styles from './QueuePlayer.module.css'

/**
 * Place+era play queue — discovery ends in sound. One tap builds a
 * queue from the panel's popularity pool: each artist resolves to an
 * era-correct verified video via /api/queue (hybrid lazy cache —
 * first build pays, everyone after plays instantly). Track 1 starts
 * the moment it resolves; the rest keep arriving while it plays.
 * Playback stays in the visible YouTube iframe player, the universal
 * free player everywhere else on the site.
 */

/** Artists resolved before playback starts — enough to start honestly. */
const INITIAL_BATCH = 15
/** Artists added per top-up once the playhead nears the end. */
const REFILL_BATCH = 10
/**
 * Top up when fewer than this many tracks remain ahead of the
 * playhead. A lookahead beats fixed checkpoints (top up at track 5,
 * 15, 25…): it self-corrects when resolves come back empty or the
 * listener skips hard, and it asks for nothing while the queue is
 * already deep enough.
 */
const REFILL_LOOKAHEAD = 10
/** Sanity ceiling on one sitting — not a target, just a stop. */
const QUEUE_MAX = 200
/** Per-artist resolve cap — one hung request must not stall the fill. */
const QUEUE_FETCH_TIMEOUT_MS = 20_000
/** No first track by this deadline → give up LOUDLY, never an eternal
 * spinner (Aug 29 fix: 40 sequential cache-miss resolves ran 10+ min). */
const FIRST_TRACK_DEADLINE_MS = 60_000
/** Concurrent resolves: first hit plays sooner; same total API calls. */
const QUEUE_CONCURRENCY = 4
/** Below this many playable tracks, say so — never pad the queue. */
const HONEST_MIN = 5
/**
 * Tracks from outside a demoted genre family that must play before a
 * held one is released (owner ruling, Aug 2026). Children's and
 * educational music stay in the queue; they just never open a place.
 *
 * Counted in TRACKS HEARD, not pool position: roughly half a pool
 * resolves to nothing, so "sixth artist in the pool" and "sixth thing
 * a visitor hears" are different numbers, and only the second one is
 * what the ruling is about.
 */
const LEAD_IN_TRACKS = 5

interface ResolvedTrack {
  videoId: string
  title: string
  artistName: string
  mbid: string
  /** In a genre family the queue holds out of its opening run. */
  demoted?: boolean
}

/**
 * Songs an already-resolved artist still has in reserve. Once every
 * artist in the pool has contributed, the fill drains these round
 * robin — one more from each artist before a second more from any —
 * so a sparse place or a narrow genre filter keeps playing instead of
 * dead-ending, without three tracks by one artist in a row.
 */
interface ArtistReserve {
  artistName: string
  mbid: string
  demoted: boolean
  tracks: { videoId: string; title: string }[]
}

/**
 * A queue candidate. MusicBrainz entries resolve through /api/queue;
 * gap-fill entries arrive carrying their own pre-verified video (the
 * resolver era-picks by MBID, which they do not have) and cost no
 * request at all.
 */
export interface QueuePoolArtist extends PoolArtist {
  queueTrack?: { videoId: string; title: string }
}

interface QueuePlayerProps {
  placeName: string
  year: number
  pool: QueuePoolArtist[]
  roster: RosterByMbid
  /**
   * Pre-verified tracks (#1 hits): the queue is already resolved, so
   * play starts instantly and the resolver walk never runs. Every
   * entry carries a playability-checked video ID by construction.
   */
  preresolved?: ResolvedTrack[]
  /** Button label override — the default names the place + year. */
  buttonLabel?: string
  /**
   * Widen the panel (and so this pool) to nearby years. Passed only
   * when widening is available and not already on; the queue offers it
   * when it runs out of artists rather than dead-ending.
   */
  onWiden?: () => void
  /** Label for the widen offer, e.g. "1964–1974". */
  widenLabel?: string
}

/** Minimal typing for the pieces of the IFrame API we drive. */
interface YtPlayer {
  loadVideoById: (videoId: string) => void
  destroy: () => void
}
interface YtNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      playerVars: Record<string, number>
      events: {
        onReady: (event: { target: { playVideo: () => void } }) => void
        onStateChange: (event: { data: number }) => void
      }
    },
  ) => YtPlayer
  PlayerState: { ENDED: number }
}

declare global {
  interface Window {
    YT?: YtNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytApiPromise: Promise<YtNamespace> | null = null

function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window !== 'undefined' && window.YT?.Player) {
    return Promise.resolve(window.YT)
  }
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      ytApiPromise = null
      reject(new Error('YouTube player failed to load'))
    }
    document.head.appendChild(script)
  })
  return ytApiPromise
}

export function QueuePlayer({
  placeName,
  year,
  pool,
  roster,
  preresolved,
  buttonLabel,
  onWiden,
  widenLabel,
}: QueuePlayerProps) {
  const [active, setActive] = useState(false)
  const [tracks, setTracks] = useState<ResolvedTrack[]>([])
  const [current, setCurrent] = useState(0)
  const [building, setBuilding] = useState(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [playerBroken, setPlayerBroken] = useState(false)

  const playerRef = useRef<YtPlayer | null>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const firstPlayedRef = useRef(false)
  const tracksRef = useRef<ResolvedTrack[]>([])
  const currentRef = useRef(0)
  tracksRef.current = tracks
  currentRef.current = current

  // Fill-engine state. Refs, not state: the fill loop reads these
  // across awaits, where a captured render's values would be stale.
  /** Pool artists already resolved (by id) — never resolved twice. */
  const resolvedIdsRef = useRef(new Set<string>())
  /** Unplayed songs held back from artists already in the queue. */
  const reservesRef = useRef<ArtistReserve[]>([])
  /** Video ids already queued — the last word on duplicates. */
  const queuedVideosRef = useRef(new Set<string>())
  /** Demoted-family tracks waiting for their lead-in to fill. */
  const heldRef = useRef<ResolvedTrack[]>([])
  /** Tracks queued from outside the demoted families. */
  const leadInRef = useRef(0)
  /**
   * Hold anything back only when there is something else to lead with.
   * One condition covers the two cases that must not stall: a visitor
   * who filtered the panel TO "kids music" (they asked for it), and a
   * place whose whole pool is one — both arrive here as a pool with no
   * non-demoted artist in it, and both should just play.
   *
   * Derived from `pool`, and read by the fill workers out of the same
   * render's closure the workers already take `pool` from — so the two
   * can never disagree about which pool is being walked.
   */
  const deferActive = useMemo(
    () => pool.some((artist) => !isDemotedArtist(artist.tags)),
    [pool],
  )
  /** True while a batch is in flight — top-ups are idempotent. */
  const fillingRef = useRef(false)
  /** Pool exhausted AND reserves drained: nothing left to add. */
  const [exhausted, setExhausted] = useState(false)
  /**
   * Bumped when a batch finishes. Without it the fill stalls: a batch
   * that resolves NOTHING (common — most artists have no MB-linked
   * channel) changes no other state, so the lookahead effect never
   * re-runs and artists further down the pool are never tried.
   */
  const [fillTick, setFillTick] = useState(0)

  useEffect(
    () => () => {
      abortRef.current?.abort()
      try {
        playerRef.current?.destroy()
      } catch {
        // Player already gone with its DOM.
      }
    },
    [],
  )

  function jumpTo(index: number) {
    const track = tracksRef.current[index]
    if (!track) return
    setCurrent(index)
    playerRef.current?.loadVideoById(track.videoId)
  }

  async function playFirst(track: ResolvedTrack) {
    try {
      const yt = await loadYouTubeApi()
      if (!mountRef.current || abortRef.current?.signal.aborted) return
      const mount = document.createElement('div')
      mountRef.current.appendChild(mount)
      playerRef.current = new yt.Player(mount, {
        videoId: track.videoId,
        playerVars: { autoplay: 1, rel: 0 },
        events: {
          onReady: (event) => event.target.playVideo(),
          onStateChange: (event) => {
            if (event.data === yt.PlayerState.ENDED) {
              jumpTo(currentRef.current + 1)
            }
          },
        },
      })
    } catch {
      setPlayerBroken(true)
    }
  }

  const [gaveUp, setGaveUp] = useState(false)

  /** Put tracks in the queue, starting the player on the first to land. */
  function commitTracks(fresh: ResolvedTrack[]) {
    if (fresh.length === 0) return
    setTracks((previous) => [...previous, ...fresh])
    if (!firstPlayedRef.current) {
      firstPlayedRef.current = true
      void playFirst(fresh[0])
    }
  }

  /** Apply a plan from lib/explore/queueOrder — the rule lives there. */
  function applyPlan(plan: AppendPlan<ResolvedTrack>) {
    heldRef.current = plan.held
    leadInRef.current = plan.leadIn
    commitTracks(plan.commit)
  }

  /** Let the held class in — the lead-in is served, or nothing else came. */
  function releaseHeld() {
    if (heldRef.current.length === 0) return
    applyPlan(releasePlan({ leadIn: leadInRef.current, held: heldRef.current }))
  }

  /**
   * Append tracks, skipping any video already queued, holding back the
   * demoted families until LEAD_IN_TRACKS others are in front of them.
   *
   * Held tracks are marked queued the moment they arrive, so the
   * dedupe still sees them and a later batch can't queue the same
   * video twice while one copy waits.
   */
  function appendTracks(incoming: ResolvedTrack[]) {
    const fresh = incoming.filter((track) => {
      if (queuedVideosRef.current.has(track.videoId)) return false
      queuedVideosRef.current.add(track.videoId)
      return true
    })
    if (fresh.length === 0) return
    applyPlan(
      planAppend(
        fresh,
        { leadIn: leadInRef.current, held: heldRef.current },
        deferActive,
        LEAD_IN_TRACKS,
      ),
    )
  }

  /**
   * Resolve up to `size` not-yet-resolved artists from the pool.
   * Returns how many artists were consumed, so the caller can tell an
   * exhausted pool from an unproductive batch.
   *
   * Bounded worker pool (Aug 29 fix): the original loop was strictly
   * sequential with untimed fetches — 40 cache-miss resolves at 15-20s
   * each read as a 10-minute "Finding the sound of…". Workers pull
   * pool-ranked artists in order; the first resolved track plays
   * immediately, whichever worker lands it. Concurrency stays at 4:
   * parallel serverless invocations share egress IPs against MB's
   * ~1 req/s courtesy limit.
   */
  async function resolveBatch(
    size: number,
    controller: AbortController,
  ): Promise<number> {
    const decade = Math.floor(year / 10) * 10
    // The pool of THIS render: every caller runs from an effect keyed
    // on `pool` (or from start()), so a widen's larger pool arrives as
    // a re-run rather than by reaching through a ref mid-render.
    const queue = pool.filter(
      (artist) => !resolvedIdsRef.current.has(artist.id),
    )
    if (queue.length === 0) return 0
    const slice = queue.slice(0, size)
    for (const artist of slice) resolvedIdsRef.current.add(artist.id)
    let nextIndex = 0
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex++
        if (index >= slice.length) return
        const artist = slice[index]
        // Classification travels with the artist, from their own tags.
        const demoted = isDemotedArtist(artist.tags)
        // Gap-fill entries carry their video already — no request, no
        // quota, no waiting. They land in resolution order like every
        // other track, so a queue with them starts sounding sooner.
        if (artist.queueTrack) {
          appendTracks([
            {
              videoId: artist.queueTrack.videoId,
              title: artist.queueTrack.title,
              artistName: artist.name,
              mbid: artist.id,
              demoted,
            },
          ])
          continue
        }
        try {
          const res = await fetch(
            `/api/queue/artist/${artist.id}/${decade}?name=${encodeURIComponent(artist.name)}`,
            {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(QUEUE_FETCH_TIMEOUT_MS),
              ]),
            },
          )
          if (res.status === 503) {
            const body = (await res.json().catch(() => ({}))) as {
              quota?: boolean
            }
            if (body.quota) {
              setQuotaHit(true)
              controller.abort()
              return
            }
            continue
          }
          if (!res.ok) continue
          const body = (await res.json()) as {
            track: { videoId: string; title: string } | null
            tracks?: { videoId: string; title: string }[]
          }
          const found = body.tracks?.length
            ? body.tracks
            : body.track
              ? [body.track]
              : []
          if (found.length === 0) continue
          // Queue their era-truest song now; the rest go to reserve, to
          // be drawn on only once every artist has had a turn.
          appendTracks([
            {
              videoId: found[0].videoId,
              title: found[0].title,
              artistName: artist.name,
              mbid: artist.id,
              demoted,
            },
          ])
          if (found.length > 1) {
            reservesRef.current = [
              ...reservesRef.current,
              {
                artistName: artist.name,
                mbid: artist.id,
                demoted,
                tracks: found.slice(1),
              },
            ]
          }
        } catch {
          // A per-request timeout skips ONE artist; a controller abort
          // ends the worker. Unmount aborts fall out of the while.
          if (controller.signal.aborted) return
        }
      }
    }
    await Promise.all(
      Array.from({ length: QUEUE_CONCURRENCY }, () => worker()),
    )
    return slice.length
  }

  /**
   * Take up to `size` songs from artists already played, one per
   * artist per pass, so the queue widens in variety before it deepens
   * on any single artist. Costs nothing: these arrived with the
   * artist's first resolve.
   */
  function drawFromReserves(size: number): ResolvedTrack[] {
    const drawn: ResolvedTrack[] = []
    let reserves = reservesRef.current
    while (drawn.length < size && reserves.some((r) => r.tracks.length > 0)) {
      reserves = reserves.map((reserve) => {
        if (drawn.length >= size || reserve.tracks.length === 0) return reserve
        const [next, ...rest] = reserve.tracks
        drawn.push({
          videoId: next.videoId,
          title: next.title,
          artistName: reserve.artistName,
          mbid: reserve.mbid,
          demoted: reserve.demoted,
        })
        return { ...reserve, tracks: rest }
      })
    }
    reservesRef.current = reserves.filter((r) => r.tracks.length > 0)
    return drawn
  }

  /**
   * One top-up: new artists first (variety), their reserves second.
   * Idempotent — concurrent triggers (track change, batch completion,
   * pool growth) collapse into one in-flight fill.
   */
  async function fill(size: number) {
    if (fillingRef.current) return
    const controller = abortRef.current
    if (!controller || controller.signal.aborted) return
    fillingRef.current = true
    setBuilding(true)
    try {
      const consumed = await resolveBatch(size, controller)
      if (controller.signal.aborted) return
      if (consumed === 0) {
        // Pool spent — fall back to second songs from played artists.
        const drawn = drawFromReserves(size)
        appendTracks(drawn)
        if (drawn.length === 0) {
          // Release valve: with nothing left to lead with, the held
          // class plays. Kids music stays in the queue — the ruling
          // was about position, and a queue that ends in silence
          // while holding playable tracks honours neither.
          if (heldRef.current.length > 0) releaseHeld()
          else setExhausted(true)
        }
      }
    } finally {
      fillingRef.current = false
      if (!controller.signal.aborted) {
        setBuilding(false)
        setFillTick((tick) => tick + 1)
      }
    }
  }

  async function start() {
    if (active) return
    setActive(true)
    if (preresolved) {
      setTracks(preresolved)
      if (preresolved[0]) {
        firstPlayedRef.current = true
        void playFirst(preresolved[0])
      }
      // Pre-verified queues are complete by construction — nothing to
      // fill, so they go straight to the end state.
      setExhausted(true)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const deadline = setTimeout(() => {
      if (firstPlayedRef.current || controller.signal.aborted) return
      // Never report "nothing found" while holding something back: a
      // slow cold cache must not turn a demotion into a dead queue.
      if (heldRef.current.length > 0) {
        releaseHeld()
        return
      }
      setGaveUp(true)
      controller.abort()
    }, FIRST_TRACK_DEADLINE_MS)
    await fill(INITIAL_BATCH)
    clearTimeout(deadline)
  }

  /**
   * The lookahead: whenever fewer than REFILL_LOOKAHEAD tracks remain
   * ahead of the playhead, pull another batch. Runs on track changes,
   * on each batch landing, and when the pool grows (a widen) — so a
   * listener who leaves it running never reaches the end of the list.
   */
  useEffect(() => {
    if (!active || preresolved || quotaHit || gaveUp || exhausted) return
    if (fillingRef.current) return
    if (tracks.length >= QUEUE_MAX) return
    const remaining = tracks.length - current
    if (remaining >= REFILL_LOOKAHEAD) return
    void fill(REFILL_BATCH)
    // `fill` is stable in behaviour and guarded by fillingRef; tracking
    // it as a dep would re-run this on every render instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    preresolved,
    quotaHit,
    gaveUp,
    exhausted,
    tracks,
    current,
    pool,
    fillTick,
  ])

  /**
   * A widen grows the pool with artists this queue has never seen, so
   * an exhausted queue becomes fillable again. Only the flag is reset:
   * resolved ids, reserves and the playing track all stand.
   */
  useEffect(() => {
    if (pool.some((artist) => !resolvedIdsRef.current.has(artist.id))) {
      setExhausted(false)
    }
  }, [pool])

  // Pool guards decide whether to OFFER a queue — they must never tear
  // one down. A widen refetches the panel, so `pool` empties for a
  // second mid-flight; returning null there unmounted a PLAYING queue
  // and took the player with it. Once active, this component owns its
  // own track list and outlives pool churn.
  if (!active) {
    if (preresolved) {
      // Pre-verified queues are exactly as long as their verified list —
      // the pool guards are resolver-walk economics, not honesty.
      if (preresolved.length === 0) return null
    } else {
      if (pool.length === 0) return null
      if (pool.length < HONEST_MIN) {
        return (
          <p className={styles.sparseNote}>
            Too few artists on record here for a real queue — no padding, no
            fillers.
          </p>
        )
      }
    }
  }

  if (!active) {
    return (
      <button type="button" className={styles.playButton} onClick={start}>
        {buttonLabel ?? `▶ Play ${placeName} ${year}`}
      </button>
    )
  }

  const nowPlaying = tracks[current]

  return (
    <div className={styles.queueBox}>
      <div className={styles.playerFrame} ref={mountRef} />

      {nowPlaying && (
        <div className={styles.nowPlaying}>
          <span className={styles.nowIndex}>
            {current + 1}/{tracks.length}
          </span>
          <span className={styles.nowTitle}>
            {nowPlaying.artistName} — {nowPlaying.title}
          </span>
          <span className={styles.controls}>
            <button
              type="button"
              className={styles.controlButton}
              onClick={() => jumpTo(current - 1)}
              disabled={current === 0}
              aria-label="Previous track"
            >
              ⏮
            </button>
            <button
              type="button"
              className={styles.controlButton}
              onClick={() => jumpTo(current + 1)}
              disabled={current >= tracks.length - 1}
              aria-label="Next track"
            >
              ⏭
            </button>
          </span>
        </div>
      )}

      {playerBroken && (
        <p className={styles.buildNote}>
          The player would not load here — the queue below still links out.
        </p>
      )}
      {!nowPlaying && !quotaHit && !gaveUp && (
        <p className={styles.buildNote}>
          Finding the sound of {placeName} {year}…
        </p>
      )}
      {gaveUp && tracks.length === 0 && (
        <p className={styles.sparseNote}>
          Couldn&rsquo;t find the sound of {placeName} {year} tonight —
          the pills below still play one by one.
        </p>
      )}
      {building && nowPlaying && (
        <p className={styles.buildNote}>
          Still digging — {tracks.length} track
          {tracks.length === 1 ? '' : 's'} so far…
        </p>
      )}
      {quotaHit && tracks.length === 0 && (
        <p className={styles.sparseNote}>
          This one&rsquo;s still brewing — try again in a bit.
        </p>
      )}
      {quotaHit && tracks.length > 0 && (
        <p className={styles.buildNote}>
          Paused mid-build for today — {tracks.length} tracks for now, the
          rest arrive on a later visit.
        </p>
      )}
      {/* ONE end-state line, and only once the fill has actually
          stopped — with continuous filling, "Still digging" and "only
          N tracks" would otherwise contradict each other mid-build.
          Widening is offered, never performed: it changes what the
          whole panel claims to show, so it stays the visitor's choice. */}
      {exhausted && !building && !quotaHit && tracks.length > 0 && (
        <p className={styles.buildNote}>
          {tracks.length < HONEST_MIN
            ? `Only ${tracks.length} verified track${tracks.length === 1 ? '' : 's'} here — honest, not padded.`
            : `That’s everything verified for ${placeName} ${year}.`}
          {onWiden && (
            <>
              {' '}
              <button
                type="button"
                className={styles.widenQueueButton}
                onClick={onWiden}
              >
                ⊕ Widen to {widenLabel} for more
              </button>
            </>
          )}
        </p>
      )}

      {tracks.length > 0 && (
        <ol className={styles.queueList}>
          {tracks.map((track, index) => (
            <li
              key={`${track.videoId}:${index}`}
              className={index === current ? styles.rowActive : styles.row}
            >
              <button
                type="button"
                className={styles.rowPlay}
                onClick={() => jumpTo(index)}
                aria-label={`Play ${track.artistName}`}
              >
                {index === current ? '▶' : index + 1}
              </button>
              {roster[track.mbid] ? (
                <Link
                  className={styles.rowArtistLink}
                  href={`/${roster[track.mbid].slug}`}
                >
                  {track.artistName}
                </Link>
              ) : (
                <span className={styles.rowArtist}>{track.artistName}</span>
              )}
              <span className={styles.rowTitle}>{track.title}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
