'use client'

import {
  discogsArtistUrl,
  discogsSearchUrl,
  extraArtistsFor,
  wikidataUrl,
  type ExtraArtist,
} from '@/lib/explore/extraArtists'
import { listenSearch } from '@/lib/links'
import styles from './FromTheCrates.module.css'

/**
 * "From the crates" — artists MusicBrainz has no record of at all,
 * documented instead by Discogs pressings and Wikidata. Deliberately
 * separate from the MusicBrainz list above it and never counted with
 * it: MB stays canonical, this only fills gaps where MB is silent.
 *
 * Two groups, never blended: acts documented as active in THIS era,
 * and acts the source carries no date for at all (most Lao pressings)
 * — the latter are labelled as undated, never implied to be the
 * selected year's music.
 */

interface FromTheCratesProps {
  countryCode: string
  countryName: string
  year: number
}

function sourceHref(artist: ExtraArtist): string {
  if (artist.discogsArtistId) return discogsArtistUrl(artist.discogsArtistId)
  if (artist.wikidataId) return wikidataUrl(artist.wikidataId)
  return discogsSearchUrl(artist.name)
}

function sourceLabel(artist: ExtraArtist): string {
  return artist.wikidataId && !artist.discogsArtistId ? 'Wikidata' : 'Discogs'
}

function ArtistRow({ artist }: { artist: ExtraArtist }) {
  const span =
    artist.firstYear === null
      ? null
      : artist.lastYear && artist.lastYear !== artist.firstYear
        ? `${artist.firstYear}–${artist.lastYear}`
        : String(artist.firstYear)

  return (
    <li className={styles.row}>
      <a
        className={styles.name}
        href={sourceHref(artist)}
        target="_blank"
        rel="noreferrer"
        title={`${artist.name} on ${sourceLabel(artist)}`}
      >
        {artist.name}
      </a>
      <span className={styles.meta}>
        {[span, artist.styles[0]].filter(Boolean).join(' · ')}
      </span>
      <a
        className={styles.listen}
        href={listenSearch(artist.name, '')}
        target="_blank"
        rel="noreferrer"
        aria-label={`Listen: search for ${artist.name}`}
      >
        ▶
      </a>
    </li>
  )
}

export function FromTheCrates({
  countryCode,
  countryName,
  year,
}: FromTheCratesProps) {
  const { dated, undated, undatedTotal } = extraArtistsFor(countryCode, year)
  if (dated.length === 0 && undated.length === 0) return null

  return (
    <section className={styles.crates}>
      <h3 className={styles.heading}>From the crates</h3>
      <p className={styles.note}>
        Beyond MusicBrainz — {countryName} artists documented by Discogs
        pressings and Wikidata. Not counted above.
      </p>

      {dated.length > 0 && (
        <ul className={styles.list}>
          {dated.map((artist) => (
            <ArtistRow key={artist.name} artist={artist} />
          ))}
        </ul>
      )}

      {undated.length > 0 && (
        <>
          <p className={styles.undatedHeading}>
            {dated.length === 0
              ? `No dated ${countryName} pressings for ${year} — but the crates hold these, undated in the source:`
              : 'Undated in the source — era unknown:'}
          </p>
          <ul className={styles.list}>
            {undated.map((artist) => (
              <ArtistRow key={artist.name} artist={artist} />
            ))}
          </ul>
          {undatedTotal > undated.length && (
            <p className={styles.moreNote}>
              …and {undatedTotal - undated.length} more undated.
            </p>
          )}
        </>
      )}
    </section>
  )
}
