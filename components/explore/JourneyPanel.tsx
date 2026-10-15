'use client'

import { useEffect, useState } from 'react'
import {
  eraSpan,
  genreList,
  journeySpan,
  type Culture,
  type CultureTrack,
  type Journey,
} from '@/lib/explore/cultureTypes'
import type { PlaceSongs } from '@/lib/explore/songsAbout'
import { youtubeThumb } from '@/lib/play/youtubeApi'
import { useYouTubeQueue } from '@/components/play/useYouTubeQueue'
import { LikeButton } from '@/components/fans/LikeButton'
import type { LikeDraft } from '@/components/fans/LikesProvider'
import { Icon } from '@/components/ui/Icon'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './JourneyPanel.module.css'

/**
 * The curated journey — the Explore panel before a place is opened.
 * An Ear Clef pick (a documented era, a place in a decade, or the songs
 * written about a place) playing here in the visible YouTube player.
 *
 * Owner rule (Oct 14, 2026), the Songs-about rule: EVERY song listed
 * plays on the site. No search links, nothing unplayable is teased —
 * the data (scripts/lib/cultures.mjs) holds only verified videos, and a
 * malformed id is dropped here too.
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
      group: 'more' as const,
      version: song.ver,
      mbid: song.mbid,
      note: [song.y, song.about ? `about ${song.about}` : null]
        .filter(Boolean)
        .join(' · '),
    }))
}

function journeyToTracks(journey: Journey): PanelTrack[] {
  return journey.tracks
    .filter((track) => VIDEO_ID.test(track.videoId))
    .map((track) => ({
      ...track,
      key: track.videoId,
      note: track.note ?? (track.year ? String(track.year) : undefined),
    }))
}

const songCount = (count: number) => `${count} song${count === 1 ? '' : 's'}`

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; tracks: PanelTrack[]; journey: Journey | null }

interface JourneyPanelProps {
  culture: Culture
  /** Open this place (at the journey's year) in the full place panel. */
  onOpenPlace: (culture: Culture) => void
  /** Feature the next journey. */
  onNext?: () => void
}

export function JourneyPanel({ culture, onOpenPlace, onNext }: JourneyPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [showAll, setShowAll] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)

  // The songs load on demand: a journey from the journey route, a
  // "Songs about" place from its own route.
  useEffect(() => {
    const controller = new AbortController()
    const url =
      culture.kind === 'songs'
        ? `/api/explore/songs-about/${culture.code}`
        : `/api/explore/journey/${culture.id}`
    fetch(url, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: Journey | PlaceSongs | null) => {
        if (!payload) {
          setLoaded({ status: 'failed' })
          return
        }
        if (culture.kind === 'songs') {
          setLoaded({ status: 'ready', tracks: songsToTracks(payload as PlaceSongs), journey: null })
        } else {
          const journey = payload as Journey
          setLoaded({ status: 'ready', tracks: journeyToTracks(journey), journey })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed' })
      })
    return () => controller.abort()
  }, [culture])

  const tracks = loaded.status === 'ready' ? loaded.tracks : []
  const journey = loaded.status === 'ready' ? loaded.journey : null
  // One player per panel; leaving the panel stops the sound with it.
  const {
    mountRef,
    current,
    ended,
    paused,
    broken,
    dead,
    toggleOrPlay,
    playAll: playJourney,
  } = useYouTubeQueue(tracks.map((track) => track.videoId))

  const playing = current !== null ? tracks[current] : null
  // The ♥ saves the song with the place and year it was heard in.
  const likeDraft = (track: (typeof tracks)[number]): LikeDraft => ({
    videoId: track.videoId,
    title: track.title,
    artistName: track.artist,
    ...(track.mbid ? { mbid: track.mbid } : {}),
    placeCode: culture.code,
    placeName: culture.place,
    ...(track.year ? { year: track.year } : {}),
  })
  const first = tracks[0]
  const visible = showAll ? tracks : tracks.slice(0, FIRST_ROWS)
  const span = culture.kind === 'songs' ? null : journeySpan(culture)
  const title =
    culture.kind === 'songs' ? (
      `Songs about ${culture.place}`
    ) : (
      <>
        {culture.place} <span className={styles.titleSpan}>· {span}</span>
      </>
    )
  const subtitle =
    culture.kind === 'era'
      ? culture.title
      : culture.kind === 'decade'
        ? culture.genres && culture.genres.length > 0
          ? `Mostly ${genreList(culture.genres)}`
          : `Music from ${culture.place}, ${span}`
        : culture.firstYear && culture.lastYear && culture.firstYear !== culture.lastYear
          ? `${songCount(culture.count)} written about ${culture.place}, ${culture.firstYear}–${culture.lastYear}`
          : `${songCount(culture.count)} written about ${culture.place}`
  const summary =
    journey?.kind === 'era'
      ? journey.summary
      : culture.kind === 'decade'
        ? `Songs released in the ${span} by artists from ${culture.place}, each one verified to play here.`
        : null
  const basisLine =
    journey?.kind === 'era'
      ? `${
          journey.basisKind === 'charted'
            ? 'An Ear Clef pick, anchored to the national chart archive.'
            : 'An Ear Clef pick, drawn from documented scene history.'
        }${
          journey.picks < tracks.length
            ? ` The era’s own picks that play here come first; then songs released in ${culture.place}, ${eraSpan(journey)}.`
            : ''
        }`
      : culture.kind === 'decade'
        ? 'An Ear Clef pick from the On this day catalogue: releases with an exact date whose video is verified as that release by that artist.'
        : 'An Ear Clef pick: songs about this place from Wikipedia’s lists — only the ones we can play here.'
  const headingId = `journey-${culture.id}`
  const firstMore = tracks.findIndex((track) => track.group === 'more')
  const showGroups = journey?.kind === 'era' && journey.picks > 0 && firstMore > 0

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <p className={styles.eyebrow}>Curated journey</p>
      <h2 id={headingId} className={styles.title}>
        {title}
      </h2>

      <div className={styles.media}>
        <div ref={mountRef} className={styles.frame} />
        {current === null &&
          (first ? (
            <button
              type="button"
              className={styles.facade}
              onClick={playJourney}
              aria-label={`Play this journey, starting with ${first.title} by ${first.artist}`}
            >
              <SafeImage className={styles.still} src={youtubeThumb(first.videoId)} />
              <span className={styles.facadePlay} aria-hidden="true">
                <Icon name="play" size={26} />
              </span>
              <span className={styles.facadeNote}>Plays here on YouTube</span>
            </button>
          ) : (
            <div className={styles.placeholder} aria-hidden="true">
              {culture.thumb && (
                <SafeImage className={styles.still} src={youtubeThumb(culture.thumb)} />
              )}
            </div>
          ))}
      </div>
      {broken && playing && (
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
      {summary && (
        <p className={`${styles.summary} ${storyOpen ? styles.summaryOpen : ''}`}>
          {summary}
        </p>
      )}
      {journey?.kind === 'era' && (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => setStoryOpen((open) => !open)}
          aria-expanded={storyOpen}
        >
          {storyOpen ? 'Show less' : 'Read the story'}
        </button>
      )}

      {loaded.status === 'loading' && (
        <p className={styles.loading}>Loading the songs…</p>
      )}
      {loaded.status === 'failed' && (
        <p className={styles.fine}>These songs didn’t load — try again shortly.</p>
      )}
      {tracks.length > 0 && (
        <button
          type="button"
          className={styles.primary}
          onClick={playJourney}
          aria-label={`Play this journey: ${songCount(tracks.length)}`}
        >
          <Icon name="play" size={16} />
          {current !== null && !ended ? 'Play from the start' : 'Play this journey'}
        </button>
      )}

      {playing && (
        <div className={styles.nowRow}>
          <p className={styles.nowPlaying} aria-live="polite">
            {ended
              ? 'That’s every song in this journey.'
              : `Now playing: “${playing.title}” — ${playing.artist}`}
          </p>
          {!ended && <LikeButton track={likeDraft(playing)} />}
        </div>
      )}

      {tracks.length > 0 && (
        <ol className={styles.tracks}>
          {visible.map((track) => {
            const index = tracks.indexOf(track)
            const isDead = dead.has(track.videoId)
            const isCurrent = index === current && !ended
            return (
              <li
                key={track.key}
                className={`${styles.track} ${isCurrent ? styles.trackCurrent : ''} ${
                  showGroups && index === firstMore ? styles.trackGroupStart : ''
                }`}
              >
                {showGroups && index === firstMore && (
                  <span className={styles.groupLabel}>
                    Also released in {culture.place}, {span}
                  </span>
                )}
                <span className={styles.art} aria-hidden="true">
                  <SafeImage src={youtubeThumb(track.videoId, 'mq')} />
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
                {!isDead && (
                  <span className={styles.trackActions}>
                    <LikeButton variant="row" track={likeDraft(track)} />
                    <button
                      type="button"
                      className={styles.trackPlay}
                      onClick={() => toggleOrPlay(index)}
                      aria-label={`${isCurrent && !paused ? 'Pause' : 'Play'} “${track.title}” by ${track.artist}`}
                    >
                      <Icon name={isCurrent && !paused ? 'pause' : 'play'} size={14} />
                    </button>
                  </span>
                )}
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
        {journey?.kind === 'era' && journey.sources.length > 0 && (
          <details className={styles.sources}>
            <summary>Sources</summary>
            <p className={styles.basis}>{journey.basis}</p>
            <ul>
              {journey.sources.map((source) => (
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
