'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useLikes } from '@/components/fans/LikesProvider'
import { QueuePlayer } from '@/components/explore/QueuePlayer'
import type { LikedTrack } from '@/lib/fans/likes'
import styles from './LikedSongs.module.css'

/** MusicBrainz id → the roster page that artist already has. */
export type RosterByMbid = Record<string, { slug: string; name: string }>

const ALL = 'all'

/**
 * The place a like was made, as a label. The stored name is used when
 * it is a real name: the globe's no-WebGL fallback can only supply the
 * ISO code, and a chip reading "GB" is honest where "GB, GB" is not.
 */
function placeLabel(track: LikedTrack): string | null {
  const { placeName, placeCode } = track
  if (placeName && placeName !== placeCode) return placeName
  return placeName ?? placeCode ?? null
}

/** Groups likes by a key, counting each — the chip rows are built from this. */
function countBy(
  likes: LikedTrack[],
  keyOf: (track: LikedTrack) => string[],
): [string, number][] {
  const counts = new Map<string, number>()
  for (const track of likes) {
    for (const key of keyOf(track)) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
}

interface ChipRowProps {
  label: string
  choices: [string, number][]
  active: string
  onChange: (choice: string) => void
  allLabel: string
}

function ChipRow({ label, choices, active, onChange, allLabel }: ChipRowProps) {
  if (choices.length < 2) return null
  return (
    <div className={styles.chipRow} role="group" aria-label={label}>
      <button
        type="button"
        className={`${styles.chip} ${active === ALL ? styles.chipOn : ''}`}
        aria-pressed={active === ALL}
        onClick={() => onChange(ALL)}
      >
        {allLabel}
      </button>
      {choices.map(([choice, count]) => (
        <button
          key={choice}
          type="button"
          className={`${styles.chip} ${active === choice ? styles.chipOn : ''}`}
          aria-pressed={active === choice}
          onClick={() => onChange(choice)}
        >
          {choice} · {count}
        </button>
      ))}
    </div>
  )
}

/**
 * The songs the listener saved, newest first, with the genre and place
 * filters the panels and the player already use. Everything shown here
 * was verified playable when it was liked, and carries the place and
 * era it was heard in.
 */
export function LikedSongs({ roster }: { roster: RosterByMbid }) {
  const { likes, ready, signedIn, toggleLike } = useLikes()
  const [genre, setGenre] = useState<string>(ALL)
  const [place, setPlace] = useState<string>(ALL)

  const genreChoices = useMemo(
    () => countBy(likes, (track) => track.genres ?? []),
    [likes],
  )
  const placeChoices = useMemo(
    () =>
      countBy(likes, (track) => {
        const label = placeLabel(track)
        return label ? [label] : []
      }),
    [likes],
  )

  const shown = useMemo(
    () =>
      likes.filter(
        (track) =>
          (genre === ALL || (track.genres ?? []).includes(genre)) &&
          (place === ALL || placeLabel(track) === place),
      ),
    [likes, genre, place],
  )

  const filtered = genre !== ALL || place !== ALL

  if (!ready) {
    return (
      <div className={styles.shimmerBlock} aria-hidden="true">
        <span className={styles.shimmer} />
        <span className={`${styles.shimmer} ${styles.shimmerShort}`} />
      </div>
    )
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Saved songs</h2>

      {likes.length === 0 ? (
        <p className={styles.empty}>
          Nothing saved yet. Tap the ♥ on a track while a queue is
          playing — on the{' '}
          <Link className={styles.link} href="/">
            globe
          </Link>
          , anywhere in the world — and it lands here.
        </p>
      ) : (
        <>
          <p className={styles.note}>
            {shown.length === likes.length
              ? `${likes.length} song${likes.length === 1 ? '' : 's'}, newest first.`
              : `${shown.length} of ${likes.length} songs.`}
            {!signedIn && (
              <>
                {' '}
                Saved in this browser only —{' '}
                <Link className={styles.link} href="/me">
                  sign in
                </Link>{' '}
                to keep them across devices.
              </>
            )}
          </p>

          <ChipRow
            label="Filter saved songs by genre"
            choices={genreChoices}
            active={genre}
            onChange={setGenre}
            allLabel="All genres"
          />
          <ChipRow
            label="Filter saved songs by place"
            choices={placeChoices}
            active={place}
            onChange={setPlace}
            allLabel="Everywhere"
          />

          {/* The queue is built from what is SHOWN, at click time — the
              same contract the country panel has. Deliberately NOT
              re-keyed on the filters: changing a chip mid-song must not
              tear down a playing queue. */}
          {shown.length > 0 && (
            <QueuePlayer
              placeName="your saved songs"
              year={new Date().getFullYear()}
              pool={[]}
              roster={roster}
              preresolved={shown.map((track) => ({
                videoId: track.videoId,
                title: track.title,
                artistName: track.artistName,
                mbid: track.mbid ?? '',
                ...(track.genres?.length && { genres: track.genres }),
              }))}
              buttonLabel={
                filtered
                  ? `▶ Play these ${shown.length}`
                  : `▶ Play all ${shown.length} saved`
              }
              // States completeness, not completion: a pre-resolved
              // queue is "exhausted" from the moment it starts, so this
              // line is on screen while track 1 is still playing.
              endNote="That’s everything saved in this queue."
            />
          )}

          {shown.length === 0 ? (
            <p className={styles.empty}>
              Nothing saved matches both filters.{' '}
              <button
                type="button"
                className={styles.reset}
                onClick={() => {
                  setGenre(ALL)
                  setPlace(ALL)
                }}
              >
                Clear filters
              </button>
            </p>
          ) : (
            <ol className={styles.list}>
              {shown.map((track) => {
                const label = placeLabel(track)
                const artist = track.mbid ? roster[track.mbid] : undefined
                return (
                  <li key={track.videoId} className={styles.row}>
                    <button
                      type="button"
                      className={styles.unlike}
                      onClick={() => toggleLike(track)}
                      aria-label={`Remove ${track.title} by ${track.artistName}`}
                      title="Remove from saved songs"
                    >
                      ♥
                    </button>
                    <span className={styles.rowMain}>
                      {artist ? (
                        <Link
                          className={styles.rowArtistLink}
                          href={`/${artist.slug}`}
                        >
                          {track.artistName}
                        </Link>
                      ) : (
                        <span className={styles.rowArtist}>
                          {track.artistName}
                        </span>
                      )}
                      <span className={styles.rowTitle}>{track.title}</span>
                    </span>
                    {(label || track.year) && (
                      <span className={styles.rowWhere}>
                        {[label, track.year].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
