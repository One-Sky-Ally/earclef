'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ArchiveArtistFacts } from '@/app/api/explore/artist/[mbid]/route'
import type {
  ArtistEraDetails,
  ArtistLinks,
} from '@/lib/explore/panelData'
import { useLikes } from '@/components/fans/LikesProvider'
import { QueuePlayer } from '@/components/explore/QueuePlayer'
import styles from './ArchiveArtist.module.css'

/** The globe's own bounds — a link outside them would land nowhere. */
const YEAR_MIN = 1900
const YEAR_MAX = 2026

type FactsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; facts: ArchiveArtistFacts }

function clampYear(year: number): number {
  return Math.min(YEAR_MAX, Math.max(YEAR_MIN, year))
}

/**
 * The artist's own era, for the globe link. Their first release is the
 * truest answer — it is when their music actually entered the world —
 * and the start of their active period is the fallback. Never guessed:
 * with neither, the link is not offered with a year at all.
 */
function eraYear(
  facts: ArchiveArtistFacts,
  releases: ArtistEraDetails | null,
): { year: number; basis: string } | null {
  const years = (releases?.eraReleases ?? [])
    .map((release) => Number(release.date?.slice(0, 4)))
    .filter((year) => Number.isInteger(year) && year >= YEAR_MIN)
  if (years.length > 0) {
    return {
      year: clampYear(Math.min(...years)),
      basis: 'their first record here',
    }
  }
  if (facts.beginYear) {
    return {
      year: clampYear(facts.beginYear),
      basis:
        facts.type === 'Person' ? 'the year they were born' : 'when they began',
    }
  }
  return null
}

/** "1939 – 2006", "1939 –", or nothing at all. */
function lifeSpan(facts: ArchiveArtistFacts): string | null {
  if (!facts.beginYear) return null
  if (facts.endYear) return `${facts.beginYear} – ${facts.endYear}`
  return facts.ended ? `${facts.beginYear} – ?` : `${facts.beginYear} –`
}

export function ArchiveArtist({ mbid }: { mbid: string }) {
  const [state, setState] = useState<FactsState>({ status: 'loading' })
  const [releases, setReleases] = useState<ArtistEraDetails | null>(null)
  const [links, setLinks] = useState<ArtistLinks | null>(null)
  const { likes } = useLikes()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/explore/artist/${mbid}`)
        if (!res.ok) {
          // Three different truths, told apart: this artist does not
          // exist, the source is throttling us, or we could not reach
          // it at all. Only the first one is permanent.
          const message =
            res.status === 404
              ? 'MusicBrainz has no artist with this id.'
              : res.status === 429
                ? 'MusicBrainz is busy right now — this card loads on a retry.'
                : 'Could not reach MusicBrainz just now.'
          if (!cancelled) setState({ status: 'error', message })
          return
        }
        const facts = (await res.json()) as ArchiveArtistFacts
        if (!cancelled) setState({ status: 'ready', facts })
      } catch {
        if (!cancelled) {
          setState({
            status: 'error',
            message: 'Could not reach MusicBrainz just now.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mbid])

  // The catalogue and the outbound links are extras: the card stands
  // without either, so neither blocks it and neither shows an error.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/explore/artist-era/${mbid}/${YEAR_MIN}-${YEAR_MAX}`,
        )
        if (!res.ok) return
        const details = (await res.json()) as ArtistEraDetails
        if (!cancelled) setReleases(details)
      } catch {
        // A card without a catalogue is still a true card.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mbid])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/explore/artist-links/${mbid}`)
        if (!res.ok) return
        const found = (await res.json()) as ArtistLinks
        if (!cancelled) setLinks(found)
      } catch {
        // Links are a bonus, never a requirement.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mbid])

  const saved = useMemo(
    () => likes.filter((track) => track.mbid === mbid),
    [likes, mbid],
  )

  if (state.status === 'loading') {
    return (
      <main className={styles.main}>
        <div className="container">
          <div className={styles.shimmerBlock} aria-hidden="true">
            <span className={styles.shimmer} />
            <span className={`${styles.shimmer} ${styles.shimmerShort}`} />
          </div>
        </div>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className={styles.main}>
        <div className="container">
          <p className={styles.error}>{state.message}</p>
          <p className={styles.errorLink}>
            <Link href="/">← Back to the globe</Link>
          </p>
        </div>
      </main>
    )
  }

  const { facts } = state
  const era = eraYear(facts, releases)
  const span = lifeSpan(facts)
  const origin = [facts.beginArea, facts.countryName]
    .filter(Boolean)
    .join(', ')
  const outbound = [
    links?.wikipedia && { label: 'Wikipedia', href: links.wikipedia },
    links?.youtube && { label: 'YouTube', href: links.youtube },
    links?.spotify && { label: 'Spotify', href: links.spotify },
    links?.appleMusic && { label: 'Apple Music', href: links.appleMusic },
    links?.amazonMusic && { label: 'Amazon Music', href: links.amazonMusic },
  ].filter(Boolean) as { label: string; href: string }[]

  return (
    <main className={styles.main}>
      <div className="container">
        <p className={styles.overline}>Archive card</p>
        <h1 className={styles.name}>{facts.name}</h1>
        {facts.disambiguation && (
          <p className={styles.disambiguation}>{facts.disambiguation}</p>
        )}

        {/* The reason this page exists. Not a footnote: no other page
            anywhere can put an artist back among their contemporaries. */}
        {facts.countryCode && era && (
          <Link
            className={styles.sceneCard}
            href={`/?y=${era.year}&c=${facts.countryCode}`}
          >
            <span className={styles.sceneOverline}>Hear the scene</span>
            <span className={styles.sceneTitle}>
              {facts.countryName ?? facts.countryCode}, {era.year}
            </span>
            <span className={styles.sceneNote}>
              Everyone else making music around them — {era.basis}. Opens the
              globe at their place and era. →
            </span>
          </Link>
        )}
        {facts.countryCode && !era && (
          <Link
            className={styles.sceneCard}
            href={`/?c=${facts.countryCode}`}
          >
            <span className={styles.sceneOverline}>Hear the scene</span>
            <span className={styles.sceneTitle}>
              {facts.countryName ?? facts.countryCode}
            </span>
            <span className={styles.sceneNote}>
              No dated record here to pin a year to — the globe opens on
              their country, and the slider does the rest. →
            </span>
          </Link>
        )}

        <dl className={styles.facts}>
          {origin && (
            <div className={styles.fact}>
              <dt className={styles.factLabel}>From</dt>
              <dd className={styles.factValue}>{origin}</dd>
            </div>
          )}
          {span && (
            <div className={styles.fact}>
              <dt className={styles.factLabel}>
                {facts.type === 'Person' ? 'Lived' : 'Active'}
              </dt>
              <dd className={styles.factValue}>{span}</dd>
            </div>
          )}
          {facts.type && (
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Type</dt>
              <dd className={styles.factValue}>{facts.type}</dd>
            </div>
          )}
        </dl>

        {facts.genres.length > 0 && (
          <ul className={styles.genres}>
            {facts.genres.map((genre) => (
              <li key={genre} className={styles.genre}>
                {genre}
              </li>
            ))}
          </ul>
        )}

        {/* Already-verified playback, at no cost: these are the
            listener's OWN saved songs by this artist. The card never
            resolves new videos — that would spend quota on every visit. */}
        {saved.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Your saved songs</h2>
            <QueuePlayer
              placeName={facts.name}
              placeCode={facts.countryCode}
              year={era?.year ?? YEAR_MAX}
              pool={[]}
              roster={{}}
              preresolved={saved.map((track) => ({
                videoId: track.videoId,
                title: track.title,
                artistName: track.artistName,
                mbid: track.mbid ?? '',
                ...(track.genres?.length && { genres: track.genres }),
              }))}
              buttonLabel={`▶ Play your ${saved.length} saved song${saved.length === 1 ? '' : 's'}`}
              endNote="That’s everything you’ve saved by them."
            />
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Releases
            {releases && releases.catalogCount > 0 && (
              <span className={styles.sectionCount}>
                {' '}
                · {releases.catalogCount}
              </span>
            )}
          </h2>
          {!releases ? (
            <p className={styles.pending}>Reading the catalogue…</p>
          ) : releases.eraReleases.length === 0 ? (
            <p className={styles.pending}>
              MusicBrainz lists no dated releases for this artist.
            </p>
          ) : (
            <>
              <ol className={styles.releases}>
                {releases.eraReleases.map((release) => (
                  <li key={release.id} className={styles.release}>
                    <span className={styles.releaseYear}>
                      {release.originalSpan
                        ? `${release.originalSpan[0]}–${release.originalSpan[1]}`
                        : (release.date?.slice(0, 4) ?? '—')}
                    </span>
                    <span className={styles.releaseTitle}>
                      {release.title}
                      {release.type && (
                        <span className={styles.releaseType}>
                          {' '}
                          {release.type}
                        </span>
                      )}
                    </span>
                    {release.editionYear && (
                      <span className={styles.releaseEdition}>
                        this edition {release.editionYear}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {releases.truncated && (
                <p className={styles.pending}>
                  A longer catalogue than this card sweeps — the rest is on
                  MusicBrainz.
                </p>
              )}
            </>
          )}
        </section>

        {outbound.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Elsewhere</h2>
            <ul className={styles.links}>
              {outbound.map((link) => (
                <li key={link.href}>
                  <a
                    className={styles.link}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Said plainly, at the bottom and in the overline: this is not
            one of the roster pages, and it must never pass as one. */}
        <footer className={styles.provenance}>
          <p>
            Assembled from{' '}
            <a
              className={styles.link}
              href={`https://musicbrainz.org/artist/${mbid}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              MusicBrainz ↗
            </a>{' '}
            — facts only, nothing written. Ear Clef&rsquo;s own artist pages
            are hand-verified and look nothing like this one.{' '}
            <Link className={styles.link} href="/artists">
              See the roster →
            </Link>
          </p>
        </footer>
      </div>
    </main>
  )
}
