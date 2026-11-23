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
import {
  ALL_GENRES,
  filterForPanelGenre,
  genreOn,
  genresIncluded,
  isAllGenres,
  matchesPanelGenre,
  onlyGenre,
  toggleGenre as toggledFilter,
  type QueueGenreFilter,
} from '@/lib/explore/queueGenreFilter'
import type { RosterByMbid } from './CountryPanel'
import { LikeButton } from '@/components/fans/LikeButton'
import { useLikes, type LikeDraft } from '@/components/fans/LikesProvider'
import { loadYouTubeApi, NO_COOKIE_HOST, type YtPlayer } from '@/lib/play/youtubeApi'
import { useOneSound } from '@/components/play/useOneSound'
import styles from './QueuePlayer.module.css'
import { countPlay } from '@/lib/tally/beacon'

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
/**
 * YouTube searches one visit may spend (owner go, Nov 19 2026). The
 * project has 100 a day for everyone, and one cold sparse place used to
 * take 44 of them in a sitting. The walk asks every artist free-only
 * first (cache, their channel, Discogs leads); searches go to the artists
 * nothing free answered, at most this many per visit, and only while
 * the queue is short. The rest are listed for the overnight job, which
 * spends each day's unused searches on them.
 */
const SEARCHES_PER_VISIT = 10
/**
 * Below this many playable tracks, say so — never pad the queue.
 * Exported because the panel hides its own thin-year widen while the
 * queue is the one offering it (one offer, not two stacked).
 */
export const QUEUE_HONEST_MIN = 5
const HONEST_MIN = QUEUE_HONEST_MIN
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

/**
 * How true a track is to the chosen year, as the resolver rated it:
 * in-era = released in the chosen decade; nearby = within ±15 years;
 * catalog = anywhere else in the artist's catalog; unknown = verified
 * as the artist's own, with no release date to hold it to a year
 * (gap-fill tracks). Absent on pre-verified queues (#1 hits, songs
 * about a place), which are era-true by construction.
 */
type TrackEra = 'in-era' | 'nearby' | 'catalog' | 'unknown'

/**
 * What plays under the year's button: in-era songs, and songs with no
 * release date to hold to a year from an artist the pool places in
 * this era (gap-fill, pre-era cache entries) — owner ruling, Oct 13
 * 2026: "let them play under the year, labeled honestly". Nearby and
 * catalog songs carry a date that says another era, and wait.
 */
function verifiedForYear(era: TrackEra): boolean {
  return era === 'in-era' || era === 'unknown'
}

function eraLabel(era: TrackEra): string {
  switch (era) {
    case 'nearby':
      return 'nearby years'
    case 'catalog':
      return 'other years'
    case 'unknown':
      return 'artist from this era · song year not confirmed'
    default:
      return ''
  }
}

interface ResolvedTrack {
  videoId: string
  title: string
  artistName: string
  mbid: string
  era?: TrackEra
  /** In a genre family the queue holds out of its opening run. */
  demoted?: boolean
  /**
   * The artist's canonical genres, captured at resolve time. Carried on
   * the TRACK rather than looked up from `pool` because the pool churns
   * — a widen empties and refills it mid-song — and a queue must not
   * lose the labels its own filter is built on.
   */
  genres?: string[]
  /**
   * Where this song was made, when a source verifies it ("Recorded in
   * Sydney, Australia"), linking to that place on the globe in the
   * song's year. Only "On this day" passes it today.
   */
  place?: { label: string; href: string; title?: string }
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
  genres: string[]
  tracks: { videoId: string; title: string; era?: TrackEra }[]
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
  /**
   * ISO code of the place this queue is walking. Saved onto a liked
   * song so the playlist can be filtered by where it was heard —
   * frozen at like time, because the pool churns.
   */
  placeCode?: string
  year: number
  /**
   * Every queue-eligible artist on the panel, NOT narrowed by the
   * panel's genre chip — the chip arrives separately as `panelGenre`
   * and becomes the queue's starting filter. Passing the whole pool is
   * what lets a listener broaden a genre queue from inside the player,
   * and it keeps a chip change mid-song from silently changing which
   * artists later refills draw from.
   */
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
  /** A widen already happened — this offer is the next, wider step. */
  widenFurther?: boolean
  /**
   * The years the queue is now drawing from, e.g. "1964–1974" after a
   * widen — so the end line names what was actually searched. `year`
   * stays the chosen year: it is the era the resolver picks against
   * and what a ♥ records.
   */
  spanLabel?: string
  /**
   * The panel's genre chip (null = all genres; undefined = this queue
   * has no panel). It sets the filter the queue STARTS under. Changing
   * it while the queue plays never rebuilds the queue on its own — the
   * queue offers to follow it, and the listener decides.
   */
  panelGenre?: string | null
  /**
   * Replaces the "that's everything for <place> <year>" end line. A
   * queue that is not a place and an era — a saved-songs playlist —
   * needs to end in its own words.
   */
  endNote?: string
  /**
   * A quiet outlined start button instead of the gold one — for a queue
   * that is an extra on the panel, not its main sound (Songs about this
   * place, owner Nov 18 2026: "a little buried").
   */
  quietStart?: boolean
}

export function QueuePlayer({
  placeName,
  placeCode,
  year,
  pool,
  roster,
  preresolved,
  buttonLabel,
  onWiden,
  widenLabel,
  widenFurther = false,
  spanLabel,
  panelGenre,
  endNote,
  quietStart = false,
}: QueuePlayerProps) {
  const [active, setActive] = useState(false)
  const [tracks, setTracks] = useState<ResolvedTrack[]>([])
  const [current, setCurrent] = useState(0)
  const [building, setBuilding] = useState(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [playerBroken, setPlayerBroken] = useState(false)
  /**
   * Pool artists the walk has finished asking about. Shown while
   * nothing plays yet, so a long walk reads as progress rather than a
   * frozen "Finding the sound of…" (Egypt 1966, Nov 18 2026).
   */
  const [checkedCount, setCheckedCount] = useState(0)
  const { atCapacity: likesAtCapacity, dismissCapacity } = useLikes()
  /**
   * Videos YouTube refused to play — pulled, private, or embedding
   * switched off since the day they were verified. They are SKIPPED,
   * not deleted: the row stays in the queue marked unplayable, because
   * a saved song silently vanishing is worse than one that says why.
   */
  const [deadIds, setDeadIds] = useState<Set<string>>(new Set())
  const deadRef = useRef<Set<string>>(new Set())
  /**
   * Which genres play, switchable live while the music plays: some
   * switched off, or only some switched on (lib/explore/queueGenreFilter).
   * Starts from the panel's genre chip at the moment the queue starts.
   */
  const [genreFilter, setGenreFilter] = useState<QueueGenreFilter>(ALL_GENRES)
  const [genresOpen, setGenresOpen] = useState(false)
  /**
   * The chip value this queue last agreed with — set at start, and
   * again when the listener follows or declines a chip change. A chip
   * that differs from it is a change made while the music played.
   */
  const [syncedPanelGenre, setSyncedPanelGenre] = useState<string | null>(
    null,
  )
  /**
   * Playback was stopped because the listener switched off every genre
   * in the queue — remembered so turning one back on resumes, instead
   * of leaving a silent player and no obvious way back.
   */
  const pausedByFilterRef = useRef(false)

  const playerRef = useRef<YtPlayer | null>(null)
  /** The YouTube player answered onReady — its methods exist from then. */
  const playerReadyRef = useRef(false)
  const mountRef = useRef<HTMLDivElement>(null)
  /**
   * One sound at a time (lib/play/oneSound.ts): another player on the
   * page started, so this queue paused. Its tracks, place in the list
   * and filters all stay; "Resume" or YouTube's own ▶ takes the sound
   * back. A queue still finding its first song keeps finding, quietly.
   */
  const [yielded, setYielded] = useState(false)
  const sound = useOneSound(() => {
    setYielded(true)
    if (!playerReadyRef.current) return
    try {
      playerRef.current?.pauseVideo()
    } catch {
      // Player already gone with its DOM.
    }
  })
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
  /** Artists only a search could answer, in pool order (free pass first). */
  const needsSearchRef = useRef<QueuePoolArtist[]>([])
  /** Searches this visit has asked for — never more than SEARCHES_PER_VISIT. */
  const searchesAskedRef = useRef(0)
  /** Artists still waiting on a search when the walk ended — said out loud. */
  const [awaitingSearch, setAwaitingSearch] = useState(0)
  /**
   * THE YEAR PROMISE (owner ruling, Oct 12 2026): "▶ Play Paraguay
   * 1910" may only play what is verified for that year. Songs the
   * resolver rated nearby / catalog / unknown are held HERE, out of the
   * queue, until the listener chooses to explore the place across all
   * years — and that choice is labelled as exactly that. Before, the
   * queue played them under the year's name (1970s and 1994 videos for
   * 1910).
   */
  const offEraRef = useRef<ArtistReserve[]>([])
  /** Artists with off-year songs on hold — what the offer can promise. */
  const [offEraCount, setOffEraCount] = useState(0)
  /** The listener chose "across all years": every era now plays, labelled. */
  const [anyYear, setAnyYear] = useState(false)
  const anyYearRef = useRef(false)
  /** Video ids already queued — the last word on duplicates. */
  const queuedVideosRef = useRef(new Set<string>())
  /**
   * The filter as the YouTube callbacks and fill workers see it. The
   * player's onStateChange closure is created once, so it would
   * otherwise advance using whatever filter was on when the track
   * started. Written together with the state by `applyFilter`, so a
   * fill started in the same tick (start()) already sees it.
   */
  const filterRef = useRef<QueueGenreFilter>(ALL_GENRES)
  function applyFilter(next: QueueGenreFilter) {
    filterRef.current = next
    setGenreFilter(next)
  }
  /** Demoted-family tracks waiting for their lead-in to fill. */
  const heldRef = useRef<ResolvedTrack[]>([])
  /** Tracks queued from outside the demoted families. */
  const leadInRef = useRef(0)
  /**
   * Hold anything back only when there is something else to lead with.
   * One condition covers the cases that must not stall: a visitor who
   * filtered TO "kids music" (on the panel chip or with "only" in the
   * player — they asked for it), and a place whose whole pool is one —
   * all arrive here as a filtered pool with no non-demoted artist in
   * it, and all should just play.
   *
   * The fill workers ask `deferNow()`, which takes `pool` from the
   * same render's closure the workers already walk and the filter from
   * its ref — so it is right even for the first batch, which starts in
   * the same tick the chip's filter is applied. `deferActive` is the
   * same answer as render state, for the effect that lets held tracks
   * in the moment deferral stops applying.
   */
  function shouldDefer(filter: QueueGenreFilter): boolean {
    return pool.some(
      (artist) =>
        genresIncluded(artist.tags, filter) && !isDemotedArtist(artist.tags),
    )
  }
  function deferNow(): boolean {
    return shouldDefer(filterRef.current)
  }
  const deferActive = useMemo(
    () => shouldDefer(genreFilter),
    // shouldDefer reads only `pool` and its argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, genreFilter],
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

  /** Whether a track plays under a filter — the rule is in queueGenreFilter. */
  function trackIncluded(
    track: ResolvedTrack,
    filter: QueueGenreFilter,
  ): boolean {
    return genresIncluded(track.genres, filter)
  }

  /**
   * The next playable index in the direction of travel, skipping what
   * is switched off. Returns -1 when there is nothing that way — the
   * caller decides whether that means "stop" or "stay put".
   */
  function seekIncluded(from: number, step: 1 | -1): number {
    const list = tracksRef.current
    for (let i = from; i >= 0 && i < list.length; i += step) {
      if (
        trackIncluded(list[i], filterRef.current) &&
        !deadRef.current.has(list[i].videoId)
      ) {
        return i
      }
    }
    return -1
  }

  /** Ref AND state: the seek reads it synchronously, the list renders it. */
  function markDead(videoId: string) {
    if (deadRef.current.has(videoId)) return
    deadRef.current = new Set([...deadRef.current, videoId])
    setDeadIds(deadRef.current)
  }

  /**
   * Move to a track. It PLAYS only while this queue holds the sound; a
   * queue paused for another player (a dead video skipped, an "only"
   * genre's first track landing) just cues it, and stays quiet.
   */
  function jumpTo(index: number, step: 1 | -1 = 1) {
    const target = seekIncluded(index, step)
    const track = tracksRef.current[target]
    if (!track) return
    setCurrent(target)
    if (sound.holds()) playerRef.current?.loadVideoById(track.videoId)
    else playerRef.current?.cueVideoById?.(track.videoId)
  }

  /** The listener chose a track here (⏮ ⏭ or a row): it takes the sound. */
  function playTrack(index: number, step: 1 | -1 = 1) {
    sound.claim()
    setYielded(false)
    jumpTo(index, step)
  }

  /** "Resume" after another player took the sound: take it back. */
  function resume() {
    sound.claim()
    setYielded(false)
    // Every genre switched off: stay silent — switching one back on
    // plays, as before. Not ready yet, or no song yet: onReady (or the
    // first song to land) plays it, now that this queue holds the sound.
    if (pausedByFilterRef.current) return
    if (playerReadyRef.current) playerRef.current?.playVideo?.()
  }

  async function playFirst(track: ResolvedTrack) {
    try {
      const yt = await loadYouTubeApi()
      if (!mountRef.current || abortRef.current?.signal.aborted) return
      const mount = document.createElement('div')
      mountRef.current.appendChild(mount)
      // Built quiet, played on ready — and only if this queue still
      // holds the sound then. A first song that lands after another
      // player started waits, cued, instead of talking over it. (An
      // autoplay flag would start it even when another player took the
      // sound while it loaded.)
      playerRef.current = new yt.Player(mount, {
        host: NO_COOKIE_HOST,
        videoId: track.videoId,
        playerVars: { autoplay: 0, rel: 0 },
        events: {
          onReady: (event) => {
            playerReadyRef.current = true
            if (sound.holds()) event.target.playVideo()
          },
          onStateChange: (event) => {
            if (event.data === yt.PlayerState.ENDED) {
              jumpTo(currentRef.current + 1, 1)
            } else if (event.data === yt.PlayerState.PLAYING) {
              // Sounding again — a next track, or YouTube's own ▶ on a
              // paused queue: whatever else plays stops.
              sound.claim()
              countPlay(tracksRef.current[currentRef.current]?.videoId)
              setYielded(false)
            }
          },
          // Without this, ONE video that died since it was verified
          // stalls the queue forever: ENDED never fires for a video
          // that never started. Mark it and move on.
          onError: () => {
            const track = tracksRef.current[currentRef.current]
            if (!track) return
            markDead(track.videoId)
            jumpTo(currentRef.current + 1, 1)
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
        deferNow(),
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
      (artist) =>
        !resolvedIdsRef.current.has(artist.id) &&
        // Resolving a switched-off artist spends a request on a track
        // that would be hidden the moment it arrived.
        genresIncluded(artist.tags, filterRef.current),
    )
    // Searches go where nothing free answered: once the free pass has
    // covered the whole pool, or sooner when the opening batch left
    // nothing to play (a silent start is the worst outcome).
    const searchesLeft = SEARCHES_PER_VISIT - searchesAskedRef.current
    const waiting = needsSearchRef.current.filter((artist) =>
      genresIncluded(artist.tags, filterRef.current),
    )
    const silentStart =
      !firstPlayedRef.current && resolvedIdsRef.current.size >= INITIAL_BATCH
    if (waiting.length > 0 && searchesLeft > 0 && (queue.length === 0 || silentStart)) {
      const searching = waiting.slice(0, Math.min(size, searchesLeft))
      const asked = new Set(searching.map((artist) => artist.id))
      needsSearchRef.current = needsSearchRef.current.filter((artist) => !asked.has(artist.id))
      searchesAskedRef.current += searching.length
      await runWorkers(searching, decade, controller, true)
      return searching.length
    }
    if (queue.length === 0) return 0
    const slice = queue.slice(0, size)
    for (const artist of slice) resolvedIdsRef.current.add(artist.id)
    await runWorkers(slice, decade, controller, false)
    return slice.length
  }

  /** Bounded worker pool over one slice of artists (see resolveBatch). */
  async function runWorkers(
    slice: QueuePoolArtist[],
    decade: number,
    controller: AbortController,
    allowSearch: boolean,
  ): Promise<void> {
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
        // Verified as the artist's own; the song's year is unconfirmed,
        // so it plays under the year with that said on the row.
        if (artist.queueTrack) {
          admit(artist, demoted, [
            {
              videoId: artist.queueTrack.videoId,
              title: artist.queueTrack.title,
              era: 'unknown',
            },
          ])
          setCheckedCount((count) => count + 1)
          continue
        }
        await resolveOne(artist, demoted, decade, controller, allowSearch)
        // The search pass re-asks artists the free pass already counted.
        if (!controller.signal.aborted && !allowSearch) {
          setCheckedCount((count) => count + 1)
        }
      }
    }
    await Promise.all(
      Array.from({ length: QUEUE_CONCURRENCY }, () => worker()),
    )
  }

  /**
   * Ask the resolver for ONE pool artist and admit what comes back. A
   * per-request timeout or a failed answer skips this artist only. A
   * "deferred" answer (only a search could find them) lists the artist
   * for the search pass. A quota answer ends this visit's searching, not
   * the walk: free answers keep coming.
   */
  async function resolveOne(
    artist: QueuePoolArtist,
    demoted: boolean,
    decade: number,
    controller: AbortController,
    allowSearch: boolean,
  ): Promise<void> {
    try {
      const res = await fetch(
        `/api/queue/artist/${artist.id}/${decade}?name=${encodeURIComponent(artist.name)}&search=${allowSearch ? 1 : 0}`,
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
          searchesAskedRef.current = SEARCHES_PER_VISIT
          // Still unanswered: count it among the artists awaiting a
          // lookup, so the end line never claims "we checked them all"
          // (code review, Nov 19 2026). The server lists it as wanted.
          if (!needsSearchRef.current.some((held) => held.id === artist.id)) {
            needsSearchRef.current = [...needsSearchRef.current, artist]
          }
        }
        return
      }
      if (!res.ok) return
      const body = (await res.json()) as {
        track: { videoId: string; title: string; era?: TrackEra } | null
        tracks?: { videoId: string; title: string; era?: TrackEra }[]
        deferred?: boolean
      }
      if (body.deferred) {
        needsSearchRef.current = [...needsSearchRef.current, artist]
        return
      }
      const found = body.tracks?.length
        ? body.tracks
        : body.track
          ? [body.track]
          : []
      if (found.length === 0) return
      admit(
        artist,
        demoted,
        // A cached entry from before era ratings carries none: it
        // is the artist's, not the year's.
        found.map((track) => ({
          videoId: track.videoId,
          title: track.title,
          era: track.era ?? 'unknown',
        })),
      )
    } catch {
      // A per-request timeout skips ONE artist; a controller abort
      // ends the walk — the worker's while sees it next.
    }
  }

  /**
   * One artist's verified songs, era-rated, arriving from the resolver
   * or a gap-fill entry. Their era-truest admitted song queues now; the
   * rest go to reserve, drawn on only once every artist has had a turn.
   * Songs NOT verified for the chosen year wait in the off-year hold
   * until the listener asks for the place across all years.
   */
  function admit(
    artist: QueuePoolArtist,
    demoted: boolean,
    songs: { videoId: string; title: string; era: TrackEra }[],
  ) {
    const reserve = {
      artistName: artist.name,
      mbid: artist.id,
      demoted,
      genres: artist.tags,
    }
    const now = songs.filter(
      (song) => anyYearRef.current || verifiedForYear(song.era),
    )
    const later = songs.filter(
      (song) => !(anyYearRef.current || verifiedForYear(song.era)),
    )
    if (now.length > 0) {
      appendTracks([{ ...now[0], ...reserve }])
      if (now.length > 1) {
        reservesRef.current = [
          ...reservesRef.current,
          { ...reserve, tracks: now.slice(1) },
        ]
      }
    }
    if (later.length > 0) {
      offEraRef.current = [...offEraRef.current, { ...reserve, tracks: later }]
      setOffEraCount((count) => count + 1)
    }
  }

  /**
   * The listener chose the place across all years. Every held song
   * joins — one per artist now, the rest to reserve — labelled by the
   * era it earned; from here on the fill admits every era too.
   */
  function playAnyYear() {
    anyYearRef.current = true
    setAnyYear(true)
    const held = offEraRef.current
    offEraRef.current = []
    setOffEraCount(0)
    const firsts: ResolvedTrack[] = []
    for (const reserve of held) {
      const [first, ...rest] = reserve.tracks
      if (!first) continue
      firsts.push({
        videoId: first.videoId,
        title: first.title,
        era: first.era,
        artistName: reserve.artistName,
        mbid: reserve.mbid,
        demoted: reserve.demoted,
        genres: reserve.genres,
      })
      if (rest.length > 0) {
        reservesRef.current = [...reservesRef.current, { ...reserve, tracks: rest }]
      }
    }
    // A queue that gave up aborted its controller — the fill needs a
    // live one to keep walking the pool.
    if (!abortRef.current || abortRef.current.signal.aborted) {
      abortRef.current = new AbortController()
    }
    setGaveUp(false)
    setExhausted(false)
    appendTracks(firsts)
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
    // Switched-off artists keep their reserves for later — drawing them
    // now would only queue hidden rows and drain songs the listener may
    // switch back on.
    const playable = (reserve: ArtistReserve) =>
      reserve.tracks.length > 0 &&
      genresIncluded(reserve.genres, filterRef.current)
    while (drawn.length < size && reserves.some(playable)) {
      reserves = reserves.map((reserve) => {
        if (drawn.length >= size || !playable(reserve)) return reserve
        const [next, ...rest] = reserve.tracks
        drawn.push({
          videoId: next.videoId,
          title: next.title,
          era: next.era,
          artistName: reserve.artistName,
          mbid: reserve.mbid,
          demoted: reserve.demoted,
          genres: reserve.genres,
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
          else {
            setAwaitingSearch(
              needsSearchRef.current.filter((artist) =>
                genresIncluded(artist.tags, filterRef.current),
              ).length,
            )
            setExhausted(true)
          }
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
    // The listener pressed play HERE: whatever else sounds stops now,
    // even while this queue is still finding its first song.
    sound.claim()
    setYielded(false)
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
    // The panel's chip at this moment is the filter the queue starts
    // under. Applied through the ref before the first fill, so the
    // workers already walk the chip's genre.
    applyFilter(filterForPanelGenre(panelGenre))
    setSyncedPanelGenre(panelGenre ?? null)
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
    if (!active || preresolved || gaveUp || exhausted) return
    if (fillingRef.current) return
    if (tracks.length >= QUEUE_MAX) return
    // Count what is actually PLAYABLE ahead. Counting every track
    // would let a queue full of switched-off genres look deep while
    // playing nothing, and the fill would never top it up.
    const remaining = tracks
      .slice(current + 1)
      .filter((track) => trackIncluded(track, genreFilter)).length
    if (remaining >= REFILL_LOOKAHEAD) return
    void fill(REFILL_BATCH)
    // `fill` is stable in behaviour and guarded by fillingRef; tracking
    // it as a dep would re-run this on every render instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    preresolved,
    gaveUp,
    exhausted,
    tracks,
    current,
    pool,
    fillTick,
    // A narrower filter can leave too little playable ahead without
    // the playing track changing — "only highlife" in a queue holding
    // one highlife track has to go and fetch more.
    genreFilter,
  ])

  /**
   * A widen grows the pool with artists this queue has never seen, so
   * an exhausted queue becomes fillable again. Only the flag is reset:
   * resolved ids, reserves and the playing track all stand.
   */
  useEffect(() => {
    if (
      pool.some((artist) => !resolvedIdsRef.current.has(artist.id)) ||
      reservesRef.current.length > 0
    ) {
      setExhausted(false)
    }
    // The filter matters here too: the fill skips switched-off artists
    // and their reserves, so a queue can exhaust purely because
    // everything left was filtered out. Switching a genre back on — or
    // choosing "only" a different one — has to reopen it.
  }, [pool, genreFilter])

  /**
   * Deferral can stop applying mid-queue — the listener chose "only
   * kids music", or switched off everything else. Held tracks then
   * come in at once rather than waiting on a lead-in that cannot come.
   */
  useEffect(() => {
    if (active && !deferActive) releaseHeld()
    // releaseHeld is a stable helper reading refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, deferActive])

  /**
   * Switching off the genre of what is PLAYING stops it. Anything else
   * would be a filter the listener can hear being ignored — and the
   * jump runs forward first, falling back to the nearest earlier
   * survivor so the queue never strands itself past the end.
   */
  useEffect(() => {
    if (!active) return
    const playing = tracksRef.current[currentRef.current]
    if (!playing) return
    if (trackIncluded(playing, genreFilter)) {
      // Something is playable again after everything was switched off.
      if (pausedByFilterRef.current) {
        pausedByFilterRef.current = false
        jumpTo(seekIncluded(0, 1))
      }
      return
    }
    const forward = seekIncluded(currentRef.current + 1, 1)
    const target = forward === -1 ? seekIncluded(currentRef.current - 1, -1) : forward
    if (target === -1) {
      // Nothing left anywhere: stop, rather than let audio keep playing
      // under a panel that says every genre is switched off.
      pausedByFilterRef.current = true
      playerRef.current?.pauseVideo()
      return
    }
    // A track that fits arrived (the fill went looking for an "only"
    // genre) or survived: play it, and forget the pause — otherwise the
    // next pass would read "playable again" and restart from the top.
    pausedByFilterRef.current = false
    jumpTo(target)
    // jumpTo/seekIncluded are stable helpers reading refs; tracking them
    // would re-run this on every render instead of on a real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreFilter, active, tracks])

  /**
   * Genres present in THIS queue, most common first. A genre chosen
   * with "only" stays listed even before its first track arrives, so
   * the listener can always see — and undo — what they asked for.
   */
  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const track of tracks) {
      for (const genre of track.genres ?? []) {
        counts.set(genre, (counts.get(genre) ?? 0) + 1)
      }
    }
    if (genreFilter.mode === 'only') {
      for (const genre of genreFilter.genres) {
        if (!counts.has(genre)) counts.set(genre, 0)
      }
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )
  }, [tracks, genreFilter])

  /** Track indices still playable, in queue order. */
  const includedIndices = useMemo(
    () =>
      tracks.flatMap((track, index) =>
        trackIncluded(track, genreFilter) ? [index] : [],
      ),
    [tracks, genreFilter],
  )

  /**
   * What a ♥ saves: the track as this queue verified it, plus the place
   * and era it was heard in. The MBID is carried only when it is real —
   * pre-resolved #1-hits tracks have none, and a bare artist name is
   * not an identity, so those likes save the song and nothing more.
   */
  function likeDraft(track: ResolvedTrack): LikeDraft {
    return {
      videoId: track.videoId,
      title: track.title,
      artistName: track.artistName,
      ...(track.mbid && { mbid: track.mbid }),
      ...(track.genres?.length && { genres: track.genres }),
      ...(placeCode && { placeCode }),
      placeName,
      year,
    }
  }

  function toggleGenre(genre: string) {
    applyFilter(toggledFilter(genre, filterRef.current))
  }

  /** "highlife" or "highlife / afrobeat" — the genres chosen with only. */
  function onlyLabel(): string {
    return [...genreFilter.genres].join(' / ')
  }

  /** The genre control's closed-state label: what is playing, briefly. */
  function genreSummary(): string {
    if (genreFilter.mode === 'only') {
      if (genreFilter.genres.size === 0) return '♪ Genres · all off'
      if (genreFilter.genres.size === 1) return `♪ Only ${onlyLabel()}`
      return `♪ Only ${genreFilter.genres.size} genres`
    }
    return genreFilter.genres.size > 0
      ? `♪ Genres · ${genreFilter.genres.size} off`
      : `♪ Genres · ${genreCounts.length}`
  }

  /** The chip changed while the music played — follow it, or don't. */
  const chipOffer =
    active &&
    !preresolved &&
    panelGenre !== undefined &&
    panelGenre !== syncedPanelGenre &&
    !matchesPanelGenre(genreFilter, panelGenre)

  function followChip() {
    applyFilter(filterForPanelGenre(panelGenre))
    setSyncedPanelGenre(panelGenre ?? null)
  }

  /** The widen offer, as one button wherever the queue makes it. */
  function widenButton(forMore: boolean) {
    if (!onWiden) return null
    return (
      <button
        type="button"
        className={styles.widenQueueButton}
        onClick={onWiden}
      >
        ⊕ Widen {widenFurther ? 'further ' : ''}to {widenLabel}
        {forMore ? ' for more' : ''}
      </button>
    )
  }

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
      // What the queue would start with: the pool under the chip.
      const startCount = panelGenre
        ? pool.filter((artist) => artist.tags.includes(panelGenre)).length
        : pool.length
      if (startCount === 0) return null
      if (startCount < HONEST_MIN) {
        // Never a dead end while there are nearby years to reach: the
        // same widen the queue offers when it runs dry. Offered, never
        // performed — it changes what the whole panel shows.
        return (
          <p className={styles.sparseNote}>
            Too few artists on record here for a real queue — no padding, no
            fillers.
            {onWiden && <> {widenButton(false)}</>}
          </p>
        )
      }
    }
  }

  if (!active) {
    return (
      <button
        type="button"
        className={quietStart ? styles.playButtonQuiet : styles.playButton}
        onClick={start}
      >
        {buttonLabel ?? `▶ Play ${placeName} ${year}`}
      </button>
    )
  }

  const nowPlaying = tracks[current]
  /**
   * The fill has stopped with nothing verified for the year, while
   * off-year songs wait on hold: say so, and offer them as what they
   * are. (`gaveUp` is the first-track deadline; `exhausted` the pool.)
   */
  const noneForYear =
    !anyYear &&
    tracks.length === 0 &&
    offEraCount > 0 &&
    (gaveUp || (exhausted && !building))
  /**
   * The walk reached the end of the pool and found NOTHING verified —
   * not for the year, not for any year. Before Nov 18 2026 no line
   * covered this end, so "Finding the sound of…" stayed up forever
   * (Egypt 1966: 68 artists, none resolvable). `gaveUp` has its own
   * line; this is the same honesty for a walk that finished in time.
   */
  const nothingFound =
    exhausted &&
    !building &&
    !gaveUp &&
    tracks.length === 0 &&
    offEraCount === 0
  /** The artists this walk will ask about, under the current filter. */
  const walkTotal = pool.filter((artist) =>
    genresIncluded(artist.tags, genreFilter),
  ).length

  return (
    // data-playing / data-player-detail: the Explore page keeps a playing
    // panel alive, shrunk to its player, while the visitor looks elsewhere
    // (ExploreClient, lib/explore/panelFrames.ts). It finds the player by
    // data-playing and hides the details marked data-player-detail.
    // A queue paused for another player is "paused", not the one playing.
    <div className={styles.queueBox} data-playing={yielded ? 'paused' : 'true'}>
      <div className={styles.playerFrame} ref={mountRef} />

      {yielded && (
        <p className={styles.buildNote}>
          Paused because another player started.{' '}
          <button type="button" className={styles.widenQueueButton} onClick={resume}>
            ▶ Resume
          </button>
        </p>
      )}

      {nowPlaying && includedIndices.length > 0 && (
        <>
        <div className={styles.nowPlaying}>
          <span className={styles.nowIndex}>
            {includedIndices.indexOf(current) + 1}/{includedIndices.length}
          </span>
          <span className={styles.nowTitle}>
            {nowPlaying.artistName} — {nowPlaying.title}
          </span>
          <span className={styles.controls}>
            <LikeButton track={likeDraft(nowPlaying)} />
            <button
              type="button"
              className={styles.controlButton}
              onClick={() => playTrack(current - 1, -1)}
              disabled={!includedIndices.some((i) => i < current)}
              aria-label="Previous track"
            >
              ⏮
            </button>
            <button
              type="button"
              className={styles.controlButton}
              onClick={() => playTrack(current + 1, 1)}
              disabled={!includedIndices.some((i) => i > current)}
              aria-label="Next track"
            >
              ⏭
            </button>
          </span>
        </div>
        {nowPlaying.place && (
          <Link className={styles.nowPlace} href={nowPlaying.place.href} title={nowPlaying.place.title}>
            {nowPlaying.place.label}
          </Link>
        )}
        </>
      )}

      {/* A full shelf refuses the save rather than dropping an older
          like to make room — so say so, and say where to make room. */}
      {likesAtCapacity && (
        <p className={styles.sparseNote}>
          Your saved songs are full — nothing was removed to make room.
          Clear a few on{' '}
          <Link className={styles.savedLink} href="/me">
            your taste map
          </Link>{' '}
          to save more.{' '}
          <button
            type="button"
            className={styles.widenQueueButton}
            onClick={dismissCapacity}
          >
            Dismiss
          </button>
        </p>
      )}

      {playerBroken && (
        <p className={styles.buildNote}>
          The player would not load here — the queue below still links out.
        </p>
      )}
      {anyYear && (
        <p className={styles.buildNote}>
          Playing {placeName} across all years — not limited to {year}; each
          song says which years it is from.
        </p>
      )}
      {!nowPlaying && !gaveUp && !noneForYear && !nothingFound && (
        <p className={styles.buildNote}>
          {anyYear
            ? `Finding more from ${placeName}, any year…`
            : `Finding the sound of ${placeName} ${year}…`}
          {!anyYear && checkedCount > 0 && walkTotal > 0 && (
            <>
              {' '}
              Checked {Math.min(checkedCount, walkTotal)} of {walkTotal}{' '}
              artists.
            </>
          )}
        </p>
      )}
      {nothingFound && awaitingSearch > 0 && (
        <p className={styles.sparseNote}>
          Nothing verified to play for {placeName} {year} yet.{' '}
          {awaitingSearch === 1 ? 'One artist here still needs' : `${awaitingSearch} artists here still need`}{' '}
          a YouTube lookup{quotaHit ? ', and we’ve reached today’s limit for those' : ''}.
          Lookups left over each day run overnight, so try again tomorrow.
          Artists below with a ▶ still link out to a recording.
          {onWiden && <> {widenButton(false)}</>}
        </p>
      )}
      {nothingFound && awaitingSearch === 0 && (
        <p className={styles.sparseNote}>
          No verified recordings to play here for {placeName} {year}
          {isAllGenres(genreFilter) ? '' : ' under this genre filter'} — we
          checked all {walkTotal} artist{walkTotal === 1 ? '' : 's'} on record.
          Artists below with a ▶ still link out to a recording.
          {onWiden && <> {widenButton(false)}</>}
        </p>
      )}
      {gaveUp && tracks.length === 0 && offEraCount === 0 && (
        <p className={styles.sparseNote}>
          Couldn&rsquo;t find the sound of {placeName} {year} tonight —
          the pills below still play one by one.
        </p>
      )}
      {/* The year promise, kept out loud: nothing verified for this year,
          and the alternative named for what it is. */}
      {noneForYear && (
        <p className={styles.sparseNote}>
          No verified recordings for {placeName} {year}.{' '}
          {offEraCount === 1
            ? 'One artist from here has'
            : `${offEraCount} artists from here have`}{' '}
          verified music from other years.{' '}
          <button
            type="button"
            className={styles.widenQueueButton}
            onClick={playAnyYear}
          >
            ▶ Explore {placeName} across all years
          </button>
          {onWiden && <> {widenButton(false)}</>}
        </p>
      )}
      {building && nowPlaying && (
        <p className={styles.buildNote}>
          Still digging — {tracks.length} track
          {tracks.length === 1 ? '' : 's'} so far…
        </p>
      )}
      {/* ONE end-state line, and only once the fill has actually
          stopped — with continuous filling, "Still digging" and "only
          N tracks" would otherwise contradict each other mid-build.
          Widening is offered, never performed: it changes what the
          whole panel claims to show, so it stays the visitor's choice. */}
      {exhausted && !building && tracks.length > 0 && (
        <p className={styles.buildNote}>
          {endNote ??
            (tracks.length < HONEST_MIN
              ? `Only ${tracks.length} verified track${tracks.length === 1 ? '' : 's'} here — honest, not padded.`
              : `That’s everything verified for ${placeName} ${spanLabel ?? year}${awaitingSearch > 0 ? ' so far' : ''}.`)}
          {awaitingSearch > 0 && (
            <>
              {' '}
              {awaitingSearch === 1 ? 'One more artist still needs' : `${awaitingSearch} more artists still need`}{' '}
              a YouTube lookup{quotaHit ? ' (today’s limit is reached)' : ''} — more
              songs may arrive tomorrow.
            </>
          )}
          {deadIds.size > 0 && (
            <>
              {' '}
              {deadIds.size === 1 ? 'One track is' : `${deadIds.size} tracks are`}{' '}
              no longer playable on YouTube — skipped, not removed.
            </>
          )}
          {onWiden && <> {widenButton(true)}</>}
          {!anyYear && offEraCount > 0 && (
            <>
              {' '}
              <button
                type="button"
                className={styles.widenQueueButton}
                onClick={playAnyYear}
              >
                ▶ Keep going with {placeName} across all years
              </button>
            </>
          )}
        </p>
      )}

      {/* The panel's chip changed while this queue played. The queue
          is never rebuilt from under the listener — it asks. */}
      {chipOffer && (
        <p className={styles.buildNote}>
          <button
            type="button"
            className={styles.widenQueueButton}
            onClick={followChip}
          >
            {panelGenre
              ? `▶ Play only ${panelGenre} from here`
              : '▶ Play all genres from here'}
          </button>{' '}
          <button
            type="button"
            className={styles.chipDismiss}
            onClick={() => setSyncedPanelGenre(panelGenre ?? null)}
          >
            keep this queue as it is
          </button>
        </p>
      )}

      {/* Genres, switchable WHILE the music plays — the panel's chip
          narrows the pool before the queue is built and cannot be
          changed once it is running. This filters what is already
          here and what gets fetched next. */}
      {(genreCounts.length > 1 || !isAllGenres(genreFilter)) && (
        <div className={styles.genreControl} data-player-detail="">
          <button
            type="button"
            className={styles.genreToggle}
            onClick={() => setGenresOpen((open) => !open)}
            aria-expanded={genresOpen}
          >
            {genreSummary()} {genresOpen ? '▾' : '▸'}
          </button>
          {genresOpen && (
            <ul className={styles.genreList}>
              {!isAllGenres(genreFilter) && (
                <li>
                  <button
                    type="button"
                    className={styles.genreOnly}
                    onClick={() => applyFilter(ALL_GENRES)}
                  >
                    All on
                  </button>
                </li>
              )}
              {genreCounts.map(([genre, count]) => {
                const on = genreOn(genre, genreFilter)
                const soleOnly =
                  genreFilter.mode === 'only' &&
                  genreFilter.genres.size === 1 &&
                  genreFilter.genres.has(genre)
                return (
                  <li key={genre} className={styles.genreItem}>
                    <button
                      type="button"
                      className={on ? styles.genreOn : styles.genreOff}
                      onClick={() => toggleGenre(genre)}
                      aria-pressed={on}
                    >
                      {on ? '●' : '○'} {genre} · {count}
                    </button>
                    {/* One tap to hear just this — switching the other
                        22 off one by one is not a control. */}
                    {!soleOnly && (
                      <button
                        type="button"
                        className={styles.genreOnly}
                        onClick={() => applyFilter(onlyGenre(genre))}
                        aria-label={`Play only ${genre}`}
                      >
                        only
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      {includedIndices.length === 0 && tracks.length > 0 && (
        <p className={styles.sparseNote}>
          {genreFilter.mode === 'only' && genreFilter.genres.size > 0
            ? exhausted && !building
              ? `No verified ${onlyLabel()} here.`
              : `Looking for ${onlyLabel()}…`
            : 'Every genre in this queue is switched off.'}{' '}
          <button
            type="button"
            className={styles.widenQueueButton}
            onClick={() => applyFilter(ALL_GENRES)}
          >
            Turn them all back on
          </button>
        </p>
      )}

      {includedIndices.length > 0 && (
        <ol className={styles.queueList} data-player-detail="">
          {includedIndices.map((index, position) => {
            const track = tracks[index]
            const dead = deadIds.has(track.videoId)
            return (
            <li
              key={`${track.videoId}:${index}`}
              className={index === current ? styles.rowActive : styles.row}
            >
              <button
                type="button"
                className={styles.rowPlay}
                onClick={() => playTrack(index)}
                disabled={dead}
                aria-label={
                  dead
                    ? `${track.artistName} is no longer playable`
                    : `Play ${track.artistName}`
                }
                title={dead ? 'No longer playable on YouTube' : undefined}
              >
                {/* Numbered by what is SHOWN — with genres switched
                    off, raw track indices would read 1, 2, 5, 7. */}
                {dead ? '⊘' : index === current ? '▶' : position + 1}
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
              {track.era && track.era !== 'in-era' && (
                <span
                  className={styles.rowEra}
                  title={
                    track.era === 'unknown'
                      ? `${track.artistName} is placed in this era; this recording's own year is not confirmed`
                      : `Verified as ${track.artistName}'s — not as ${year}'s`
                  }
                >
                  {eraLabel(track.era)}
                </span>
              )}
              {track.place && (
                <Link
                  className={styles.rowPlace}
                  href={track.place.href}
                  title={track.place.title ?? track.place.label}
                >
                  {track.place.label}
                </Link>
              )}
              <LikeButton track={likeDraft(track)} variant="row" />
            </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
