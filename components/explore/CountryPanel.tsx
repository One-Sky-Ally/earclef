'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  fetchArtistLinks,
  fetchCountryYearDetails,
  musicBrainzArtistUrl,
  musicBrainzReleaseUrl,
  youtubeSearchUrl,
  type CountryYearDetails,
  type PanelArtist,
  type PanelRelease,
  type PoolArtist,
} from '@/lib/explore/panelData'
import { YEAR_MAX, YEAR_MIN, type DataSource } from '@/lib/explore/counts'
import { archiveAudioSearchUrl, listenSearch } from '@/lib/links'
import { useListenService } from '@/components/listen/ServiceProvider'
import type { ListenService } from '@/lib/listen/services'
import type { ArtistLinks } from '@/lib/explore/panelData'
import { WhatWasPlaying } from '@/components/explore/WhatWasPlaying'
import styles from './CountryPanel.module.css'

export interface SelectedCountry {
  code: string
  name: string
}

/** MBID → roster page, so globe artists who live here link home. */
export type RosterByMbid = Record<string, { slug: string; name: string }>

interface CountryPanelProps {
  country: SelectedCountry
  year: number
  /** Active genre lens — switches the panel to emerged-artist mode. */
  genre?: string | null
  source: DataSource | null
  roster?: RosterByMbid
  onClose: () => void
}

/** ±reach of the one-tap "show nearby years" widen. */
const NEARBY_REACH = 5
/** Below this many results, the panel offers to widen. */
const NEARBY_OFFER_THRESHOLD = 5

/**
 * Discovery tiers: 5 → 20 → +20 steps → 100. Strict popularity order —
 * each expansion is the next tier down. 100 is also the hard render
 * cap everywhere (tiers, chip filters, name search).
 */
const TIER_BASE = 5
const TIER_SECOND = 20
const TIER_STEP = 20
const RENDER_CAP = 100
/** Chips shown per panel — the place's loudest genres, by prevalence. */
const CHIP_LIMIT = 12

function nextTier(visible: number): number {
  return visible === TIER_BASE
    ? TIER_SECOND
    : Math.min(visible + TIER_STEP, RENDER_CAP)
}

/**
 * The place+era's own genre fingerprint: tags ordered by how many pool
 * artists carry them. A tag needs a few artists behind it to qualify —
 * junk and one-off tags never recur (small pools relax the bar so tiny
 * scenes still get chips). Excluded: the active global lens (the pool
 * is already filtered to it) and the place's own name ("finland" is a
 * popular MB tag, but it isn't a genre).
 */
function genreChips(
  pool: PoolArtist[],
  lens: string | null,
  placeName: string,
): string[] {
  const prevalence = new Map<string, number>()
  for (const artist of pool) {
    for (const tag of artist.tags) {
      prevalence.set(tag, (prevalence.get(tag) ?? 0) + 1)
    }
  }
  const place = placeName.trim().toLowerCase()
  const minArtists = pool.length >= 30 ? 3 : 2
  return [...prevalence.entries()]
    .filter(
      ([tag, count]) =>
        count >= minArtists && tag !== lens && tag.toLowerCase() !== place,
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, CHIP_LIMIT)
    .map(([tag]) => tag)
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; details: CountryYearDetails }

const PREVIEW_COUNT = 5

// listenSearch quotes the title but leaves the artist bare, so name variants
// can't zero out the results while the search stays on-target ("Black Widow"
// the band, not the Marvel film). Artists get their top release as a
// discriminator.
function releaseSearchHref(release: PanelRelease): string {
  return listenSearch(release.artist.name, release.title)
}

function artistSearchHref(
  artist: PanelArtist,
  releases: PanelRelease[],
): string {
  const topRelease = releases.find(
    (release) => release.artist.id === artist.id,
  )?.title
  return topRelease
    ? listenSearch(artist.name, topRelease)
    : youtubeSearchUrl(`"${artist.name}" music`)
}


/** Session-lived client cache; the API layer caches for 30 days. */
const artistLinksCache = new Map<string, ArtistLinks>()

function smartArtistHref(
  links: ArtistLinks,
  service: ListenService,
): string | null {
  const serviceLink =
    service === 'spotify'
      ? links.spotify
      : service === 'appleMusic'
        ? links.appleMusic
        : service === 'amazonMusic'
          ? links.amazonMusic
          : links.youtube
  return serviceLink ?? links.website ?? links.wikipedia ?? null
}

interface PanelArtistPillProps {
  artist: PanelArtist
  releases: PanelRelease[]
  rosterEntry?: { slug: string; name: string }
}

/**
 * Artist pill: roster artists keep the gold home link; everyone else
 * gets a lazy smart chain on the name — the fan's streaming service if
 * MusicBrainz knows the link, else official site, else Wikipedia, else
 * MusicBrainz itself. Links resolve on first click (~1s) and cache.
 */
function PanelArtistPill({
  artist,
  releases,
  rosterEntry,
}: PanelArtistPillProps) {
  const { service } = useListenService()
  const [resolving, setResolving] = useState(false)

  async function openSmartLink(event: React.MouseEvent) {
    // Plain left-clicks resolve the chain; modified clicks keep the
    // MusicBrainz href for open-in-new-tab muscle memory.
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    // iOS Safari blocks window.open outside the tap's call stack — so
    // claim the tab SYNCHRONOUSLY inside the gesture and point it at
    // the resolved link afterwards. If even that is blocked, fall back
    // to navigating this tab rather than silently doing nothing.
    const pending = window.open('', '_blank')
    let links = artistLinksCache.get(artist.id)
    if (!links) {
      setResolving(true)
      try {
        links = await fetchArtistLinks(artist.id, new AbortController().signal)
      } catch {
        links = {}
      }
      artistLinksCache.set(artist.id, links)
      setResolving(false)
    }
    const href = smartArtistHref(links, service) ?? musicBrainzArtistUrl(artist.id)
    if (pending) {
      pending.location.href = href
    } else {
      window.location.assign(href)
    }
  }

  return (
    <li className={styles.artistItem}>
      {rosterEntry ? (
        <Link
          className={`${styles.artistPill} ${styles.onRoster}`}
          href={`/${rosterEntry.slug}`}
          title="On the Ear Clef roster — opens their page here"
        >
          {artist.name}
        </Link>
      ) : (
        <a
          className={`${styles.artistPill} ${resolving ? styles.pillResolving : ''}`}
          href={musicBrainzArtistUrl(artist.id)}
          onClick={openSmartLink}
          target="_blank"
          rel="noreferrer"
        >
          {resolving ? `${artist.name}…` : artist.name}
        </a>
      )}
      <a
        className={styles.listenBadge}
        href={artistSearchHref(artist, releases)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Listen: search YouTube for ${artist.name}`}
      >
        ▶
      </a>
    </li>
  )
}

export function CountryPanel({
  country,
  year,
  genre = null,
  source,
  roster = {},
  onClose,
}: CountryPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  // Discovery controls over the pool: tier depth, active genre chip,
  // name query. All reset on remount (parent keys by country+year).
  const [visible, setVisible] = useState(TIER_BASE)
  const [chip, setChip] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllReleases, setShowAllReleases] = useState(false)
  // "Released in" is demoted: collapsed behind a small pill until asked.
  const [releasesOpen, setReleasesOpen] = useState(false)
  // Bumped by the error state's Try-again button — re-runs the fetch.
  const [attempt, setAttempt] = useState(0)
  // One-tap widen for thin year+place combos: fetches ±NEARBY_REACH
  // years through the still-span-capable API instead of dead-ending.
  // Resets naturally — the parent keys this component by country+year.
  const [nearby, setNearby] = useState(false)

  const yearStart = nearby ? Math.max(YEAR_MIN, year - NEARBY_REACH) : year
  const yearEnd = nearby ? Math.min(YEAR_MAX, year + NEARBY_REACH) : year
  const spanLabel =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}–${yearEnd}`
  // Subdivision panels (e.g. Hawaii, US-HI) are artists-only — MB
  // pressing data is country-level, so release copy would mislead.
  const isSubdivision = /^[A-Z]{2}-[A-Z]{2}$/.test(country.code)

  // Parent keys this component by country+year, so every fetch cycle
  // starts from a fresh mount in the 'loading' state; a retry bumps
  // `attempt` and runs it again from here.
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })

    fetchCountryYearDetails(
      country.code,
      yearStart,
      yearEnd,
      genre,
      controller.signal,
    )
      .then((details) => setState({ status: 'ready', details }))
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error.message })
      })

    return () => controller.abort()
  }, [country.code, yearStart, yearEnd, genre, attempt])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // The discovery pool — cached pre-pool responses degrade to the
  // top-12 list (no tags → no chips, search over what's there).
  const pool: PoolArtist[] = useMemo(
    () =>
      state.status !== 'ready'
        ? []
        : (state.details.panelArtists?.length
            ? state.details.panelArtists
            : state.details.originArtists.map((artist) => ({
                ...artist,
                tags: [],
              }))),
    [state],
  )
  const chips = useMemo(
    () => genreChips(pool, genre, country.name),
    [pool, genre, country.name],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool.filter(
      (artist) =>
        (!chip || artist.tags.includes(chip)) &&
        (!q || artist.name.toLowerCase().includes(q)),
    )
  }, [pool, chip, query])
  // A name query shows every match (≤cap); otherwise the tier depth.
  const shown = query.trim()
    ? filtered.slice(0, RENDER_CAP)
    : filtered.slice(0, Math.min(visible, RENDER_CAP))

  return (
    <aside
      className={styles.panel}
      role="dialog"
      aria-label={`${country.name}, ${spanLabel}`}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.country}>{country.name}</h2>
          <p className={styles.year}>
            {spanLabel}
            {nearby && ' · around your year'}
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close panel"
        >
          ✕
        </button>
      </header>

      {state.status === 'loading' && (
        <>
          <p className={styles.note}>
            Listening for {spanLabel} in {country.name}…
          </p>
          <div className={styles.skeleton} aria-hidden="true">
            <div className={styles.skeletonPills}>
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index} className={styles.skeletonPill} />
              ))}
            </div>
            <div className={styles.skeletonRows}>
              {Array.from({ length: 4 }, (_, index) => (
                <span key={index} className={styles.skeletonRow} />
              ))}
            </div>
          </div>
        </>
      )}

      {state.status === 'error' && (
        <>
          <p className={styles.note}>{state.message}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && (
        <div className={styles.body}>
          <p className={styles.total}>
            {state.details.totalCount.toLocaleString()}{' '}
            {genre
              ? `${genre} artist${state.details.totalCount === 1 ? '' : 's'} from here`
              : isSubdivision
                ? `artist${state.details.totalCount === 1 ? '' : 's'} from here on record`
                : `release${state.details.totalCount === 1 ? '' : 's'} issued here`}
          </p>
          {state.details.totalCount > 0 && !isSubdivision && (
            <p className={styles.methodNote}>
              Counted by where releases were issued or distributed — artists
              may hail from elsewhere.
            </p>
          )}
          {country.code === 'AQ' && (
            <p className={styles.penguinNote}>
              Yes, really — no one lives here, but some artists register
              Antarctica as home as a running joke. We report the database
              faithfully, penguins and all.
            </p>
          )}

          {state.details.totalCount === 0 && (
            <p className={styles.note}>
              Nothing on record here for {spanLabel} — yet. MusicBrainz grows every
              day.
            </p>
          )}

          {/* Thin year? One tap widens to nearby years — never a dead end. */}
          {!nearby &&
            state.details.totalCount < NEARBY_OFFER_THRESHOLD && (
            <button
              type="button"
              className={styles.retry}
              onClick={() => setNearby(true)}
            >
              Show nearby years ({Math.max(YEAR_MIN, year - NEARBY_REACH)}–
              {Math.min(YEAR_MAX, year + NEARBY_REACH)}) →
            </button>
          )}
          {nearby && (
            <button
              type="button"
              className={styles.retry}
              onClick={() => setNearby(false)}
            >
              ← Back to {year} only
            </button>
          )}

          {pool.length > 0 && (
            <>
              <h3 className={styles.subheading}>
                Top {genre ? `${genre} ` : ''}artists from {country.name}
              </h3>

              {/* This place+era's own genres, loudest first. */}
              {chips.length > 0 && (
                <div
                  className={styles.chipsRow}
                  role="group"
                  aria-label={`Genres in ${country.name}, ${spanLabel}`}
                >
                  {chips.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={chip === tag ? styles.chipActive : styles.chip}
                      aria-pressed={chip === tag}
                      onClick={() => {
                        setChip((current) => (current === tag ? null : tag))
                        setVisible(TIER_BASE)
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {pool.length > TIER_SECOND && (
                <input
                  className={styles.nameFilter}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a name here…"
                  aria-label={`Search artists in ${country.name}`}
                />
              )}

              {shown.length === 0 ? (
                <p className={styles.note}>
                  {chip
                    ? `No ${chip} artists match here in ${spanLabel}.`
                    : `No names match here in ${spanLabel}.`}
                </p>
              ) : (
                <ul className={styles.artists}>
                  {shown.map((artist) => (
                    <PanelArtistPill
                      key={artist.id}
                      artist={artist}
                      releases={state.details.releases}
                      rosterEntry={roster[artist.id]}
                    />
                  ))}
                </ul>
              )}

              {!query.trim() &&
                shown.length < Math.min(filtered.length, RENDER_CAP) && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setVisible(nextTier)}
                >
                  {visible === TIER_BASE ? 'Show more' : 'Show next 20'}
                </button>
              )}
              {!query.trim() && visible > TIER_BASE && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setVisible(TIER_BASE)}
                >
                  Show fewer
                </button>
              )}
              {!query.trim() &&
                shown.length >= RENDER_CAP &&
                filtered.length > RENDER_CAP && (
                <p className={styles.capNote}>
                  {chip
                    ? `Top ${RENDER_CAP} ${chip} artists shown.`
                    : `Top ${RENDER_CAP} shown — pick a genre to dig deeper.`}
                </p>
              )}
            </>
          )}

          {pool.length === 0 &&
            state.details.artists.length > 0 && (
            <>
              <h3 className={styles.subheading}>On these releases</h3>
              <ul className={styles.artists}>
                {(showAllArtists
                  ? state.details.artists
                  : state.details.artists.slice(0, PREVIEW_COUNT)
                ).map((artist) => (
                  <PanelArtistPill
                    key={artist.id}
                    artist={artist}
                    releases={state.details.releases}
                    rosterEntry={roster[artist.id]}
                  />
                ))}
              </ul>
              {state.details.artists.length > PREVIEW_COUNT && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setShowAllArtists((value) => !value)}
                >
                  {showAllArtists
                    ? 'Show fewer'
                    : `Show all ${state.details.artists.length}`}
                </button>
              )}
            </>
          )}

          {/* Cultural snapshot AFTER the artists — people first, era second. */}
          {!genre && (
            <WhatWasPlaying
              countryCode={country.code}
              countryName={country.name}
              yearStart={yearStart}
              yearEnd={yearEnd}
            />
          )}

          {state.details.releases.length > 0 && (
            <div className={styles.releasesFold}>
              <button
                type="button"
                className={styles.releasesPill}
                onClick={() => setReleasesOpen((value) => !value)}
                aria-expanded={releasesOpen}
              >
                {state.details.originArtists.length > 0
                  ? `Released in ${country.name}`
                  : 'Releases'}
                {' · '}
                {state.details.totalCount.toLocaleString()}
                <span aria-hidden="true"> {releasesOpen ? '▾' : '▸'}</span>
              </button>
              {releasesOpen && (
                <>
              <ul className={styles.releases}>
                {(showAllReleases
                  ? state.details.releases
                  : state.details.releases.slice(0, PREVIEW_COUNT)
                ).map((release) => (
                  <li key={release.id} className={styles.release}>
                    <div className={styles.releaseText}>
                      <a
                        className={styles.releaseTitle}
                        href={musicBrainzReleaseUrl(release.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {release.title}
                      </a>
                      <span className={styles.releaseMeta}>
                        {release.artist.name}
                        {release.date ? ` · ${release.date}` : ''}
                      </span>
                    </div>
                    <a
                      className={styles.listenLink}
                      href={releaseSearchHref(release)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Listen: search YouTube for ${release.title} by ${release.artist.name}`}
                    >
                      ▶ Listen
                    </a>
                    {yearEnd < 1950 && (
                      <a
                        className={styles.listenLink}
                        href={archiveAudioSearchUrl(
                          release.artist.name,
                          release.title,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Search the Internet Archive for ${release.title} by ${release.artist.name}`}
                      >
                        Archive ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {state.details.releases.length > PREVIEW_COUNT && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setShowAllReleases((value) => !value)}
                >
                  {showAllReleases
                    ? 'Show fewer'
                    : `Show all ${state.details.releases.length}`}
                </button>
              )}
              {showAllReleases &&
                state.details.totalCount > state.details.releases.length && (
                  <p className={styles.truncationNote}>
                    Showing the first {state.details.releases.length} of{' '}
                    {state.details.totalCount.toLocaleString()} on record.
                  </p>
                )}
                </>
              )}
            </div>
          )}

          {source === 'simulated' && (
            <p className={styles.disclaimer}>
              The heat map is simulated for now — this list is live from
              MusicBrainz.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
