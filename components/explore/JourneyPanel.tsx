'use client'

import { useEffect, useRef, useState } from 'react'
import {
  eraSpan,
  type Culture,
  type CultureTrack,
} from '@/lib/explore/cultures'
import type { PlaceSongs } from '@/lib/explore/songsAbout'
import { resolveListenHref } from '@/lib/listen/services'
import { loadYouTubeApi, youtubeThumb, type YtPlayer } from '@/lib/play/youtubeApi'
import { useListenService } from '@/components/listen/ServiceProvider'
import { LikeButton } from '@/components/fans/LikeButton'
import { Icon } from '@/components/ui/Icon'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './JourneyPanel.module.css'

/**
 * The curated journey — the Explore panel before a place is opened.
 * An Ear Clef pick (a documented era, or the songs written about a
 * place), with its verified songs playing here in the visible YouTube
 * player. Picks the site has no verified video for stay in the list
 * without a ▶, offering a labelled search on the listener's service.
 */

interface PanelTrack extends CultureTrack {
  key: string
  /** A version (live, cover…) rather than the plain record. */
  version?: string
}

const VIDEO_ID = /^[\w-]{11}$/
/** Rows shown before "Show all". */
const FIRST_ROWS = 3

function songsToTracks(payload: PlaceSongs): PanelTrack[] {
  return payload.songs
    .filter((song) => VIDEO_ID.test(song.v) && song.t && song.a)
    .map((song) => ({
      key: song.v,
      artist: song.a,
      title: song.t.replace(/^"|"$/g, ''),
      videoId: song.v,
      version: song.ver,
      note: [song.y, song.about ? `about ${song.about}` : null]
        .filter(Boolean)
        .join(' · '),
    }))
}

const songCount = (count: number) => `${count} song${count === 1 ? '' : 's'}`

interface JourneyPanelProps {
  culture: Culture
  /** Open this place (at the era's year) in the full place panel. */
  onOpenPlace: (culture: Culture) => void
  /** Feature the next journey. */
  onNext?: () => void
}

export function JourneyPanel({ culture, onOpenPlace, onNext }: JourneyPanelProps) {
  const { service } = useListenService()
  const [songs, setSongs] = useState<PanelTrack[] | null>(null)
  const [songsFailed, setSongsFailed] = useState(false)
  const [current, setCurrent] = useState<number | null>(null)
  const [dead, setDead] = useState<ReadonlySet<string>>(new Set())
  const [ended, setEnded] = useState(false)
  const [paused, setPaused] = useState(false)
  const [broken, setBroken] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)
  const mountRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const currentRef = useRef<number | null>(null)
  const deadRef = useRef<Set<string>>(new Set())
  const tracksRef = useRef<PanelTrack[]>([])
  const disposedRef = useRef(false)

  // A "Songs about" place loads its songs on demand.
  useEffect(() => {
    if (culture.kind !== 'songs') return
    const controller = new AbortController()
    fetch(`/api/explore/songs-about/${culture.code}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<PlaceSongs>) : null))
      .then((payload) => {
        if (payload) setSongs(songsToTracks(payload))
        else setSongsFailed(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setSongsFailed(true)
      })
    return () => controller.abort()
  }, [culture])

  // One player per panel; leaving the panel stops the sound with it.
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [])

  // What plays here comes first; picks with no verified video follow,
  // each offering a labelled search. Order within each group is kept.
  const tracks: PanelTrack[] =
    culture.kind === 'era'
      ? [
          ...culture.tracks.filter((track) => track.videoId),
          ...culture.tracks.filter((track) => !track.videoId),
        ].map((track, index) => ({ ...track, key: `${index}:${track.title}` }))
      : (songs ?? [])
  // Player callbacks read the list through a ref — synced after render.
  useEffect(() => {
    tracksRef.current = tracks
  })
  const playableCount = tracks.filter((track) => track.videoId).length

  function nextPlayable(from: number): number {
    const list = tracksRef.current
    for (let index = from; index < list.length; index++) {
      const id = list[index].videoId
      if (id && !deadRef.current.has(id)) return index
    }
    return -1
  }

  function advance() {
    const next = nextPlayable((currentRef.current ?? -1) + 1)
    if (next >= 0) void playAt(next)
    else setEnded(true)
  }

  async function playAt(index: number) {
    const track = tracksRef.current[index]
    if (!track?.videoId) return
    currentRef.current = index
    setCurrent(index)
    setEnded(false)
    if (playerRef.current) {
      playerRef.current.loadVideoById(track.videoId)
      return
    }
    try {
      const yt = await loadYouTubeApi()
      if (disposedRef.current || !mountRef.current) return
      const target = document.createElement('div')
      mountRef.current.replaceChildren(target)
      playerRef.current = new yt.Player(target, {
        videoId: track.videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (event) => event.target.playVideo(),
          onStateChange: (event) => {
            if (event.data === yt.PlayerState.ENDED) advance()
            else if (event.data === yt.PlayerState.PLAYING) setPaused(false)
            else if (event.data === yt.PlayerState.PAUSED) setPaused(true)
          },
          // A video that died since it was verified is skipped, and
          // its row says so — never a stalled journey.
          onError: () => {
            const failed = tracksRef.current[currentRef.current ?? -1]?.videoId
            if (failed) {
              deadRef.current = new Set([...deadRef.current, failed])
              setDead(deadRef.current)
            }
            advance()
          },
        },
      })
    } catch {
      setBroken(true)
    }
  }

  /** The current row's button pauses and resumes; any other row plays. */
  function onRowPlay(index: number) {
    const player = playerRef.current
    if (index === currentRef.current && player && !ended) {
      if (paused) player.playVideo?.()
      else player.pauseVideo()
      return
    }
    void playAt(index)
  }

  function playJourney() {
    const first = nextPlayable(0)
    if (first >= 0) void playAt(first)
  }

  const playing = current !== null ? tracks[current] : null
  const firstPlayable = tracks.find((track) => track.videoId)
  const visible = showAll ? tracks : tracks.slice(0, FIRST_ROWS)
  const title =
    culture.kind === 'era' ? (
      <>
        {culture.place}{' '}
        <span className={styles.titleSpan}>· {eraSpan(culture)}</span>
      </>
    ) : (
      `Songs about ${culture.place}`
    )
  const subtitle =
    culture.kind === 'era'
      ? culture.title
      : culture.firstYear && culture.lastYear && culture.firstYear !== culture.lastYear
        ? `${songCount(culture.count)} written about ${culture.place}, ${culture.firstYear}–${culture.lastYear}`
        : `${songCount(culture.count)} written about ${culture.place}`
  const basisLine =
    culture.kind === 'era'
      ? culture.basisKind === 'charted'
        ? 'An Ear Clef pick, anchored to the national chart archive.'
        : 'An Ear Clef pick, drawn from documented scene history.'
      : 'An Ear Clef pick: songs about this place from Wikipedia’s lists — only the ones we can play here.'
  const headingId = `journey-${culture.id}`

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <p className={styles.eyebrow}>Curated journey</p>
      <h2 id={headingId} className={styles.title}>
        {title}
      </h2>

      <div className={styles.media}>
        <div ref={mountRef} className={styles.frame} />
        {current === null && (
          firstPlayable?.videoId ? (
            <button
              type="button"
              className={styles.facade}
              onClick={playJourney}
              aria-label={`Play this journey, starting with ${firstPlayable.title} by ${firstPlayable.artist}`}
            >
              <SafeImage
                className={styles.still}
                src={youtubeThumb(firstPlayable.videoId)}
              />
              <span className={styles.facadePlay} aria-hidden="true">
                <Icon name="play" size={26} />
              </span>
              <span className={styles.facadeNote}>Plays here on YouTube</span>
            </button>
          ) : (
            <div className={styles.placeholder} aria-hidden="true">
              <span className={styles.placeholderPlace}>{culture.place}</span>
              {culture.kind === 'era' && (
                <span className={styles.placeholderEra}>{eraSpan(culture)}</span>
              )}
            </div>
          )
        )}
      </div>
      {broken && playing?.videoId && (
        <p className={styles.notice}>
          The YouTube player didn’t load here.{' '}
          <a
            href={`https://www.youtube.com/watch?v=${playing.videoId}`}
            target="_blank"
            rel="noreferrer"
          >
            Watch “{playing.title}” on YouTube ↗
          </a>
        </p>
      )}

      <h3 className={styles.subtitle}>{subtitle}</h3>
      {culture.kind === 'era' && (
        <p className={`${styles.summary} ${storyOpen ? styles.summaryOpen : ''}`}>
          {culture.summary}
        </p>
      )}
      {culture.kind === 'era' && (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => setStoryOpen((open) => !open)}
          aria-expanded={storyOpen}
        >
          {storyOpen ? 'Show less' : 'Read the story'}
        </button>
      )}

      {playableCount > 0 ? (
        <button
          type="button"
          className={styles.primary}
          onClick={playJourney}
          aria-label={`Play this journey: ${playableCount} song${playableCount === 1 ? '' : 's'}`}
        >
          <Icon name="play" size={16} />
          {current !== null && !ended ? 'Play from the start' : 'Play this journey'}
        </button>
      ) : culture.kind === 'songs' && !songs && !songsFailed ? (
        <p className={styles.loading}>Loading the songs…</p>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={() => onOpenPlace(culture)}
        >
          Explore {culture.place} on the globe
          <Icon name="arrowRight" size={16} />
        </button>
      )}

      {playing && (
        <p className={styles.nowPlaying} aria-live="polite">
          {ended
            ? 'That’s every pick we can play here.'
            : `Now playing: “${playing.title}” — ${playing.artist}`}
        </p>
      )}

      {tracks.length > 0 && (
        <ol className={styles.tracks}>
          {visible.map((track) => {
            const index = tracks.indexOf(track)
            const isDead = Boolean(track.videoId && dead.has(track.videoId))
            const isCurrent = index === current && !ended
            const listen = track.videoId
              ? null
              : resolveListenHref(service, undefined, track.artist, track.title)
            return (
              <li
                key={track.key}
                className={`${styles.track} ${isCurrent ? styles.trackCurrent : ''}`}
              >
                <span className={styles.art} aria-hidden="true">
                  {track.videoId ? (
                    <SafeImage src={youtubeThumb(track.videoId, 'mq')} />
                  ) : (
                    '♪'
                  )}
                </span>
                <span className={styles.trackText}>
                  <span className={styles.trackArtist}>{track.artist}</span>
                  <span
                    className={styles.trackTitle}
                    title={track.note ? `${track.title} · ${track.note}` : undefined}
                  >
                    {track.title}
                    {track.live && <span className={styles.tag}>live version</span>}
                    {track.version && <span className={styles.tag}>{track.version}</span>}
                    {isDead ? (
                      <span className={styles.trackNote}> · No longer plays on YouTube</span>
                    ) : (
                      track.note && <span className={styles.trackNote}> · {track.note}</span>
                    )}
                  </span>
                </span>
                {track.videoId && !isDead ? (
                  <span className={styles.trackActions}>
                    <LikeButton
                      variant="row"
                      track={{
                        videoId: track.videoId,
                        title: track.title,
                        artistName: track.artist,
                        placeCode: culture.code,
                        placeName: culture.place,
                        ...(culture.kind === 'era' ? { year: culture.from } : {}),
                      }}
                    />
                    <button
                      type="button"
                      className={styles.trackPlay}
                      onClick={() => onRowPlay(index)}
                      aria-label={`${isCurrent && !paused ? 'Pause' : 'Play'} “${track.title}” by ${track.artist}`}
                    >
                      <Icon name={isCurrent && !paused ? 'pause' : 'play'} size={14} />
                    </button>
                  </span>
                ) : listen?.kind === 'search' ? (
                  <a
                    className={styles.trackSearch}
                    href={listen.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${listen.label}: ${track.title} by ${track.artist}`}
                    title={`${listen.label} ↗`}
                  >
                    Search
                    <Icon name="external" size={13} />
                  </a>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
      {tracks.length > FIRST_ROWS && (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
        >
          {showAll ? 'Show fewer' : `Show all ${tracks.length}`}
        </button>
      )}
      {culture.kind === 'era' && playableCount === 0 && (
        <p className={styles.fine}>
          None of these picks has a verified video on the site yet, so nothing
          plays in this panel. Open the place on the globe to hear verified
          songs from {culture.place} in these years.
        </p>
      )}
      {culture.kind === 'era' && playableCount > 0 && playableCount < tracks.length && (
        <p className={styles.fine}>
          {playableCount} of {tracks.length} picks play here — the rest link to a
          labelled search.
        </p>
      )}
      {songsFailed && (
        <p className={styles.fine}>These songs didn’t load — try again shortly.</p>
      )}

      <div className={styles.footer}>
        <p className={styles.pick}>{basisLine}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => onOpenPlace(culture)}
          >
            Open {culture.place} on the globe
          </button>
          {onNext && (
            <button type="button" className={styles.secondary} onClick={onNext}>
              Another journey
            </button>
          )}
        </div>
        {culture.kind === 'era' && culture.sources.length > 0 && (
          <details className={styles.sources}>
            <summary>Sources</summary>
            <p className={styles.basis}>{culture.basis}</p>
            <ul>
              {culture.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
