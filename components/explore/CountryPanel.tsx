'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  fetchArtistLinks,
  fetchCountryYearDetails,
  musicBrainzArtistUrl,
  type CountryYearDetails,
  type PanelArtist,
  type PoolArtist,
} from '@/lib/explore/panelData'
import { YEAR_MAX, YEAR_MIN, type DataSource } from '@/lib/explore/counts'
import { canonicalizeTags } from '@/lib/explore/genreFamilies'
import { fetchArtistPlay } from '@/lib/play/client'
import { pickPlayForService } from '@/lib/play/pick'
import { PLAY_LABELS, type ArtistPlay } from '@/lib/play/types'
import { useListenService } from '@/components/listen/ServiceProvider'
import type { ListenService } from '@/lib/listen/services'
import type { ArtistLinks } from '@/lib/explore/panelData'
import { WhatWasPlaying } from '@/components/explore/WhatWasPlaying'
import { HitsSection } from '@/components/explore/HitsSection'
import { QueuePlayer } from '@/components/explore/QueuePlayer'
import {
  CONTESTED_NOTE,
  isContestedEra,
  polityLinesFor,
} from '@/lib/explore/historicalPolities'
import {
  CLAIMED_PLACE_LINE,
  claimedPlaceById,
} from '@/lib/explore/claimedPlaces'
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
  /** "Surprise me" landing: spotlight one artist from the top tier. */
  spotlight?: boolean
  onClose: () => void
}

/** Spotlight draws from this many top-tier artists, rank-weighted. */
const SPOTLIGHT_TIER = 8

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
/** Dropdown option cap — searchable, so a cap loses nothing. */
const GENRE_OPTION_CAP = 250
/**
 * BLOCKED PENDING OWNER RULING (Aug 30, 2026 — gap-fill play identity).
 * Gap-fill entries carry a pre-verified `queueTrack` and the queue can
 * play them with no resolver walk at all, which is exactly what sparse
 * places need. But the enrichment pass that gave those videos titles
 * revealed that the committed links frequently name the WRONG ARTIST:
 * "T.O. Jazz" (Ghana) plays a Leipzig boys' choir carol, "C.K. Mann"
 * plays Keith Jarrett's Köln Concert, Louis Armstrong plays a techno
 * remix. Root cause in scripts/build-extra-play.mjs: it takes any
 * community video attached to a Discogs release the artist appears on
 * — somebody else's track, on a compilation — and verifies only that
 * the video is playable, never whose it is.
 *
 * A wrong pill is one bad click the visitor can judge; a wrong queue
 * entry AUTO-PLAYS. So the queue stays MusicBrainz-only until the
 * dataset is repaired (see data/gap-fill-play-identity-audit.json).
 */
const GAP_FILL_QUEUES_ENABLED = false

function nextTier(visible: number): number {
  return visible === TIER_BASE
    ? TIER_SECOND
    : Math.min(visible + TIER_STEP, RENDER_CAP)
}

interface GenreOption {
  tag: string
  count: number
}

/**
 * The place+era's full genre fingerprint: EVERY pool tag with how many
 * artists carry it, prevalence first (ties alphabetical) — tiny scenes
 * included, since the genre window is exactly how artists outside the
 * overall top 100 become reachable. Excluded: the active global lens
 * (the pool is already filtered to it) and the place's own name
 * ("finland" is a popular MB tag, but it isn't a genre).
 */
function genreOptions(
  pool: PoolArtist[],
  lens: string | null,
  placeName: string,
): GenreOption[] {
  const prevalence = new Map<string, number>()
  for (const artist of pool) {
    for (const tag of artist.tags) {
      prevalence.set(tag, (prevalence.get(tag) ?? 0) + 1)
    }
  }
  const place = placeName.trim().toLowerCase()
  return [...prevalence.entries()]
    .filter(([tag]) => tag !== lens && tag.toLowerCase() !== place)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }))
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; details: CountryYearDetails }

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
  // links.website removed from the chain (Aug 29 2026 incident).
  return serviceLink ?? links.wikipedia ?? null
}

/**
 * The panel's render pool. MusicBrainz entries and the gap-fill
 * entries (Discogs/Wikidata, for places MB has no record of) are ONE
 * list to visitors — same pill, same tiers, same genre filter. The
 * only difference is where a pill points, and it is invisible until
 * clicked. "Never merge" is a data rule (separate storage, separate
 * dedup, MB canonical); it is not a display rule.
 */
interface PanelPoolArtist extends PoolArtist {
  /** Non-MB entry: the pill links out to the source documenting it. */
  externalUrl?: string
  /** Source carries no date at all — sorts last, tagged quietly. */
  undated?: boolean
  /** Verified-play resolver key for non-MB entries (dg:/wd:/nm:). */
  playKey?: string
  /** Non-MB entry's pre-verified video for the queue (see QueuePlayer). */
  queueTrack?: { videoId: string; title: string }
}

interface PanelArtistPillProps {
  artist: PanelPoolArtist
  /** The panel's decade — lets the resolver reuse queue-verified videos. */
  decade: number
  rosterEntry?: { slug: string; name: string }
}

/**
 * Artist pill: roster artists keep the gold home link; everyone else
 * gets a lazy smart chain on the name — the fan's streaming service if
 * MusicBrainz knows the link, else official site, else Wikipedia, else
 * MusicBrainz itself. Links resolve on first click (~1s) and cache.
 *
 * The ▶ badge renders ONLY once a verified play destination resolves
 * (playability-checked video, MB-linked artist page, or a matching
 * Internet Archive item). No verified destination → no badge; the pill
 * itself remains the read-about link. Never a search URL.
 */
function PanelArtistPill({ artist, decade, rosterEntry }: PanelArtistPillProps) {
  const { service } = useListenService()
  const [resolving, setResolving] = useState(false)
  const [playResult, setPlayResult] = useState<ArtistPlay | null>(null)
  // The badge link derives at render: within the streaming fallback the
  // fan's chosen service wins (lib/play/pick.ts), and a later service
  // change re-picks from the already-fetched list — never a refetch.
  const play = playResult ? pickPlayForService(playResult, service) : null

  useEffect(() => {
    const controller = new AbortController()
    fetchArtistPlay(
      {
        key: artist.playKey ?? `mb:${artist.id}`,
        name: artist.name,
        decade,
      },
      controller.signal,
    )
      .then((resolved) => {
        if (!controller.signal.aborted) setPlayResult(resolved)
      })
      .catch(() => {
        // Unresolvable → no badge, which is the honest default.
      })
    return () => controller.abort()
  }, [artist.playKey, artist.id, artist.name, decade])

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
      {artist.externalUrl ? (
        // Same pill, different destination — the source that has them.
        <a
          className={styles.artistPill}
          href={artist.externalUrl}
          target="_blank"
          rel="noreferrer"
        >
          {artist.name}
          {artist.undated && (
            <span className={styles.undatedTag}> · undated</span>
          )}
        </a>
      ) : rosterEntry ? (
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
      {play && (
        <a
          className={styles.listenBadge}
          href={play.url}
          target="_blank"
          rel="noreferrer"
          title={PLAY_LABELS[play.kind]}
          aria-label={`${PLAY_LABELS[play.kind]}: ${artist.name}`}
        >
          ▶
        </a>
      )}
    </li>
  )
}

export function CountryPanel({
  country,
  year,
  genre = null,
  source,
  roster = {},
  spotlight = false,
  onClose,
}: CountryPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  // Discovery controls over the pool: tier depth + the genre filter
  // (dropdown open state, search-within-options text, selection). All
  // reset on remount (parent keys by country+year).
  const [visible, setVisible] = useState(TIER_BASE)
  const [genreFilter, setGenreFilter] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [genreQuery, setGenreQuery] = useState('')
  // Bumped by the error state's Try-again button — re-runs the fetch.
  const [attempt, setAttempt] = useState(0)
  /** A refetch over already-shown data (a widen), not a cold load. */
  const [refreshing, setRefreshing] = useState(false)
  // One-tap widen for thin year+place combos: fetches ±NEARBY_REACH
  // years through the still-span-capable API instead of dead-ending.
  // Resets naturally — the parent keys this component by country+year.
  const [nearby, setNearby] = useState(false)

  const [contestedOpen, setContestedOpen] = useState(false)
  useEffect(() => setContestedOpen(false), [country.code, year])
  const yearStart = nearby ? Math.max(YEAR_MIN, year - NEARBY_REACH) : year
  const yearEnd = nearby ? Math.min(YEAR_MAX, year + NEARBY_REACH) : year
  const claimedPlace = claimedPlaceById(country.code)
  // A claimed place is contested by definition — that is why it is
  // not a plain country; the asterisk and the one note always apply.
  const contested =
    isContestedEra(country.code, yearStart, yearEnd) || Boolean(claimedPlace)
  const spanLabel =
    yearStart === yearEnd ? `${yearStart}` : `${yearStart}–${yearEnd}`

  // Parent keys this component by country+year, so every fetch cycle
  // starts from a fresh mount in the 'loading' state; a retry bumps
  // `attempt` and runs it again from here.
  useEffect(() => {
    const controller = new AbortController()
    // Widening REFRESHES, it does not reload: dropping back to
    // 'loading' unmounts the whole ready subtree, and the play queue
    // lives in there — a widen mid-song killed the player and the
    // track list with it. Keep showing what we have (the header note
    // says a refresh is running) and swap the data in when it lands.
    setState((previous) =>
      previous.status === 'ready' ? previous : { status: 'loading' },
    )
    setRefreshing(true)

    fetchCountryYearDetails(
      country.code,
      yearStart,
      yearEnd,
      genre,
      controller.signal,
    )
      .then((details) => {
        setState({ status: 'ready', details })
        setRefreshing(false)
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error.message })
        setRefreshing(false)
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
  const mbPool: PoolArtist[] = useMemo(
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

  /**
   * One list. MusicBrainz first (tag-weight ranked, the deepest
   * signal), then era-dated gap-fill entries in press-count order,
   * then undated ones — no cross-source ranking is invented, because
   * MB tag votes and Discogs pressing counts share no scale. Styles
   * lowercase so they pool with MB tags in the genre filter.
   */
  const pool: PanelPoolArtist[] = useMemo(() => {
    // Gap-fill entries arrive SHAPED from the API (pill URL + play key
    // computed server-side) — the dataset never ships to the client.
    // Stored pre-change payloads lack the field; degrade to MB-only.
    // Archive-presence entries are NOT in this pool: they render in
    // their own section and never join the count or the genre filter.
    const extra =
      state.status === 'ready' ? state.details.extraArtists : undefined
    // One canonicalization for every source that reaches this list.
    // MB entries arrive already collapsed (the server had to, before
    // its top-4 cut destroyed the evidence); gap-fill styles, state,
    // historical and claimed-place entries carry their full lists and
    // are collapsed here. canonicalizeTags is idempotent, so the one
    // call covers all of them without caring which is which.
    return [...mbPool, ...(extra?.dated ?? []), ...(extra?.undated ?? [])].map(
      (artist) => ({ ...artist, tags: canonicalizeTags(artist.tags) }),
    )
  }, [mbPool, state])
  const archivePool: PanelPoolArtist[] = useMemo(
    () =>
      state.status === 'ready'
        ? (state.details.extraArtists?.archive ?? [])
        : [],
    [state],
  )
  const options = useMemo(
    () => genreOptions(pool, genre, country.name),
    [pool, genre, country.name],
  )
  const shownOptions = useMemo(() => {
    const q = genreQuery.trim().toLowerCase()
    return options
      .filter((option) => !q || option.tag.toLowerCase().includes(q))
      .slice(0, GENRE_OPTION_CAP)
  }, [options, genreQuery])
  const filtered = useMemo(
    () =>
      genreFilter
        ? pool.filter((artist) => artist.tags.includes(genreFilter))
        : pool,
    [pool, genreFilter],
  )
  const queuePool = useMemo(
    () =>
      GAP_FILL_QUEUES_ENABLED
        ? filtered.filter((artist) => !artist.playKey || artist.queueTrack)
        : filtered.filter((artist) => !artist.playKey),
    [filtered],
  )
  const shown = filtered.slice(0, Math.min(visible, RENDER_CAP))

  function selectGenre(tag: string | null) {
    setGenreFilter(tag)
    setVisible(TIER_BASE)
    setFilterOpen(false)
    setGenreQuery('')
  }

  // Surprise landing: one rank-weighted draw from the top tier — the
  // memo keeps the pick stable across re-renders of this mount.
  const spotlightArtist = useMemo(() => {
    if (!spotlight || pool.length === 0) return null
    const tier = pool.slice(0, Math.min(SPOTLIGHT_TIER, pool.length))
    const weights = tier.map((_, rank) => 1 / (rank + 1.5))
    let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0)
    for (let i = 0; i < tier.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return tier[i]
    }
    return tier[tier.length - 1]
  }, [spotlight, pool])

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
            {contested && (
              <button
                type="button"
                className={styles.contestedMark}
                aria-label="Contested history — see note"
                aria-expanded={contestedOpen}
                title={CONTESTED_NOTE}
                onClick={() => setContestedOpen((open) => !open)}
              >
                *
              </button>
            )}
          </p>
          {claimedPlace && (
            <p className={styles.eraNote}>{CLAIMED_PLACE_LINE}</p>
          )}
          {contested && contestedOpen && (
            <p className={styles.eraNote}>* {CONTESTED_NOTE}</p>
          )}
          {/* Era-aware polity line (historical-map Phase A): a quiet
              fact about what this place was in the selected era. V1
              covers only uncontested dissolutions/divisions — the
              table is the owner-reviewed registry. */}
          {polityLinesFor(country.code, yearStart, yearEnd).map((line) => (
            <p key={line} className={styles.eraNote}>
              {line}
            </p>
          ))}
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
          {/* A widen keeps the current list on screen while the wider
              span loads — say so, rather than letting it look stuck. */}
          {refreshing && (
            <p className={styles.note}>Widening to {spanLabel}…</p>
          )}
          {/* Editorial line (locked): only artists FROM a place appear —
              distribution reach is not local culture. Release data still
              feeds the heat map and listen links under the hood. */}
          {country.code === 'AQ' && pool.length > 0 && (
            <p className={styles.penguinNote}>
              Yes, really — no one lives here, but some artists register
              Antarctica as home as a running joke. We report the database
              faithfully, penguins and all.
            </p>
          )}

          {pool.length === 0 && (
            <p className={styles.note}>
              No artists from here on record for {spanLabel} — yet. The
              catalogs grow every day.
            </p>
          )}

          {/* Thin year? One tap widens to nearby years — never a dead end. */}
          {!nearby && pool.length < NEARBY_OFFER_THRESHOLD && (
            <button
              type="button"
              className={styles.widen}
              onClick={() => setNearby(true)}
            >
              Show nearby years ({Math.max(YEAR_MIN, year - NEARBY_REACH)}–
              {Math.min(YEAR_MAX, year + NEARBY_REACH)}) →
            </button>
          )}
          {nearby && (
            <button
              type="button"
              className={styles.widen}
              onClick={() => setNearby(false)}
            >
              ← Back to {year} only
            </button>
          )}

          {/* Discovery ends in sound — the queue walks the same
              popularity ranking, and now the same genre filter, as the
              list below. MusicBrainz entries only for the moment: see
              GAP_FILL_QUEUES_ENABLED above for why the gap-fill half
              is held back.

              Deliberately NOT re-keyed on genreFilter: the pool is
              read at click time, so changing the filter mid-song
              leaves the playing queue standing rather than tearing
              down the player. Place and year DO re-key — they are a
              different place and era, not a different view of one. */}
          <QueuePlayer
            key={`${country.code}:${year}:${genre ?? ''}`}
            placeName={country.name}
            year={year}
            pool={queuePool}
            roster={roster}
            buttonLabel={
              genreFilter
                ? `▶ Play ${genreFilter} — ${country.name} ${year}`
                : undefined
            }
            // Offered only while there is somewhere to widen TO: the
            // queue asks when it runs dry, and widening the panel is
            // what answers it — one truth for the list and the queue.
            onWiden={nearby ? undefined : () => setNearby(true)}
            widenLabel={`${Math.max(YEAR_MIN, year - NEARBY_REACH)}–${Math.min(YEAR_MAX, year + NEARBY_REACH)}`}
          />

          {spotlightArtist && (
            <div className={styles.spotlight}>
              <p className={styles.spotlightEyebrow}>Your surprise</p>
              <ul className={styles.artists}>
                <PanelArtistPill
                  artist={spotlightArtist}
                  decade={Math.floor(year / 10) * 10}
                  rosterEntry={roster[spotlightArtist.id]}
                />
              </ul>
              {spotlightArtist.tags.length > 0 && (
                <p className={styles.spotlightTags}>
                  {spotlightArtist.tags.slice(0, 3).join(' · ')}
                </p>
              )}
            </div>
          )}

          {pool.length > 0 && (
            <>
              {/* Filter by genre — the discovery lever, above the list:
                  every tag in this place+era's pool, tiny scenes
                  included, each a window past the overall top 100. */}
              {options.length > 0 && (
                <div className={styles.genreFilter}>
                  <button
                    type="button"
                    className={
                      genreFilter
                        ? styles.genreFilterButtonActive
                        : styles.genreFilterButton
                    }
                    aria-expanded={filterOpen}
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    ♪ {genreFilter ?? 'Filter by genre'}
                    <span aria-hidden="true"> {filterOpen ? '▾' : '▸'}</span>
                  </button>
                  {genreFilter && (
                    <button
                      type="button"
                      className={styles.genreClear}
                      onClick={() => selectGenre(null)}
                      aria-label="Clear genre filter"
                    >
                      ✕
                    </button>
                  )}
                  {filterOpen && (
                    <div className={styles.genreList}>
                      {options.length > 12 && (
                        <input
                          className={styles.genreSearch}
                          type="search"
                          value={genreQuery}
                          onChange={(event) =>
                            setGenreQuery(event.target.value)
                          }
                          placeholder="Type to narrow…"
                          aria-label="Search genres"
                        />
                      )}
                      <ul className={styles.genreOptions}>
                        {genreFilter && (
                          <li>
                            <button
                              type="button"
                              className={styles.genreOption}
                              onClick={() => selectGenre(null)}
                            >
                              All genres
                            </button>
                          </li>
                        )}
                        {shownOptions.map(({ tag, count }) => (
                          <li key={tag}>
                            <button
                              type="button"
                              className={
                                tag === genreFilter
                                  ? styles.genreOptionActive
                                  : styles.genreOption
                              }
                              onClick={() => selectGenre(tag)}
                            >
                              {tag}
                              <span className={styles.genreCount}>
                                {' '}
                                · {count} artist{count === 1 ? '' : 's'}
                              </span>
                            </button>
                          </li>
                        ))}
                        {shownOptions.length === 0 && (
                          <li className={styles.genreEmpty}>
                            No genre matches.
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <h3 className={styles.subheading}>
                Top{' '}
                {genreFilter
                  ? `${genreFilter} `
                  : genre
                    ? `${genre} `
                    : ''}
                artists from {country.name} ·{' '}
                {(genreFilter ? filtered.length : pool.length).toLocaleString()}
              </h3>

              {shown.length === 0 ? (
                <p className={styles.note}>
                  Nothing matches here in {spanLabel}.
                </p>
              ) : (
                <ul className={styles.artists}>
                  {shown.map((artist) => (
                    <PanelArtistPill
                      key={artist.id}
                      artist={artist}
                      decade={Math.floor(year / 10) * 10}
                      rosterEntry={roster[artist.id]}
                    />
                  ))}
                </ul>
              )}

              {shown.length < Math.min(filtered.length, RENDER_CAP) && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setVisible(nextTier)}
                >
                  {visible === TIER_BASE ? 'Show more' : 'Show next 20'}
                </button>
              )}
              {visible > TIER_BASE && (
                <button
                  type="button"
                  className={styles.showAll}
                  onClick={() => setVisible(TIER_BASE)}
                >
                  Show fewer
                </button>
              )}
              {shown.length >= RENDER_CAP && filtered.length > RENDER_CAP && (
                <p className={styles.capNote}>
                  {genreFilter
                    ? `Top ${RENDER_CAP} ${genreFilter} artists shown.`
                    : `Top ${RENDER_CAP} shown — filter by genre to dig deeper.`}
                </p>
              )}
            </>
          )}

          {/* Archive presence (presence model, Aug 2026): identity
              established, origin affirmatively unestablished. The
              records were verified pressed here — that is the entire
              claim, and the copy says so. Never in the pool, the
              count, the genre filter, rankings, or the heat map. */}
          {!genre && archivePool.length > 0 && (
            <section className={styles.archiveSection}>
              <h3 className={styles.archiveHeading}>
                From the {country.name} record archive
              </h3>
              <p className={styles.archiveNote}>
                These artists appear on records pressed here — that much
                is verified. Where they were from, no database says.
                We&rsquo;d rather play the music than pretend to know.
              </p>
              <ul className={styles.artists}>
                {archivePool.map((artist) => (
                  <PanelArtistPill
                    key={artist.id}
                    artist={artist}
                    decade={Math.floor(year / 10) * 10}
                    rosterEntry={roster[artist.id]}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Chart facts + cultural snapshot AFTER the artists —
              people first, era second. The hits section self-gates:
              it renders ONLY where an authoritative chart exists. */}
          {!genre && (
            <HitsSection
              countryCode={country.code}
              countryName={country.name}
              yearStart={yearStart}
              yearEnd={yearEnd}
            />
          )}
          {!genre && (
            <WhatWasPlaying
              countryCode={country.code}
              countryName={country.name}
              yearStart={yearStart}
              yearEnd={yearEnd}
            />
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
