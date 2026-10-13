'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  loadSurpriseData,
  pickSurprise,
  type SurpriseEra,
} from '@/lib/explore/surprise'
import {
  DEFAULT_YEAR,
  YEAR_MAX,
  YEAR_MIN,
  type DataSource,
} from '@/lib/explore/counts'
import {
  isGenreLens,
  loadGenreData,
  type GenreEmergenceData,
  type GenreLens,
} from '@/lib/explore/genreData'
import {
  MIN_FEATURED_PLAYABLE,
  cultureRow,
  eraYear,
  type Culture,
  type EraJourney,
  type SongPlace,
} from '@/lib/explore/cultures'
import type { SearchChoice } from '@/lib/explore/panelData'
import type { FocusRequest } from '@/components/explore/GlobeScene'
import { YearSlider } from '@/components/explore/YearSlider'
import { SearchBox } from '@/components/explore/SearchBox'
import { GenreStory } from '@/components/explore/GenreStory'
import { FlatMap } from '@/components/explore/FlatMap'
import { CountryList } from '@/components/explore/CountryList'
import { JourneyPanel } from '@/components/explore/JourneyPanel'
import { MusicCultures } from '@/components/explore/MusicCultures'
import {
  EXPLORE_VIEWS,
  ViewSwitch,
  type ExploreView,
} from '@/components/explore/ViewSwitch'
import {
  ArtistEraPanel,
  type SelectedArtist,
} from '@/components/explore/ArtistEraPanel'
import {
  CountryPanel,
  type RosterByMbid,
  type SelectedCountry,
} from '@/components/explore/CountryPanel'
import { EXPLORE_SEARCH_ID } from '@/components/SiteNavLinks'
import { Icon } from '@/components/ui/Icon'
import styles from './ExploreClient.module.css'

const GlobeScene = dynamic(
  () => import('@/components/explore/GlobeScene').then((m) => m.GlobeScene),
  {
    ssr: false,
    loading: () => <p className={styles.loading}>Spinning up the world…</p>,
  },
)

/** Below this width the page is one column and the panel sits below. */
const STACKED_QUERY = '(max-width: 899px)'

/** Same journey all day, a different one tomorrow — for every visitor. */
function dailyIndex(length: number): number {
  const day = Math.floor(Date.now() / 86_400_000)
  return length > 0 ? day % length : 0
}

interface ExploreClientProps {
  roster?: RosterByMbid
  /** Documented "What was playing" eras — the surprise picker's 30%. */
  surpriseEras?: SurpriseEra[]
  /** Curated era journeys (lib/explore/cultures.json). */
  eras?: EraJourney[]
  /** "Songs about" places, for the culture row and ?j= links. */
  songPlaces?: SongPlace[]
}

export function ExploreClient({
  roster = {},
  surpriseEras = [],
  eras = [],
  songPlaces = [],
}: ExploreClientProps) {
  const [year, setYear] = useState(DEFAULT_YEAR)
  // The SETTLED year: panels key off this, so a drag never storms them
  // with per-tick remounts and refetches. Follows `year` after 350ms of
  // quiet; programmatic jumps (surprise, deep links) set both at once.
  const [panelYear, setPanelYear] = useState(DEFAULT_YEAR)
  const [source, setSource] = useState<DataSource | null>(null)
  const [selected, setSelected] = useState<SelectedCountry | null>(null)
  // Artist search result — takes over the panel slot from the country.
  const [artist, setArtist] = useState<SelectedArtist | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [genreData, setGenreData] = useState<GenreEmergenceData | null>(null)
  const [lens, setLens] = useState<GenreLens | null>(null)
  const [lensOpen, setLensOpen] = useState(false)
  // Globe / Map / List — three views of the same place, year and lens.
  const [view, setView] = useState<ExploreView>('globe')
  const [globeUnavailable, setGlobeUnavailable] = useState(false)
  // The curated journey in the panel slot when no place is open. Chosen
  // on mount (daily, or from ?j=), so the server render stays neutral.
  const [journeyId, setJourneyId] = useState<string | null>(null)
  // Picked by the visitor (card, link, "Another journey") — only then
  // does the journey go into the share URL.
  const [journeyPinned, setJourneyPinned] = useState(false)
  // Deep-linked country (?c=JM), held until the globe can fly to it.
  const pendingCountry = useRef<string | null>(null)
  // ?noglobe=1 forces the non-globe fallback (testing + weak devices).
  // Captured at FIRST RENDER — the URL-writer effect below rewrites the
  // address bar before the globe's async init could ever read it.
  const [noGlobe] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('noglobe'),
  )
  // "Surprise me": combos already landed on this session, the pending
  // year tween, and which panel gets the artist spotlight.
  const [surpriseBusy, setSurpriseBusy] = useState(false)
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null)
  const surpriseSeen = useRef(new Set<string>())
  const yearTween = useRef<ReturnType<typeof setInterval> | null>(null)
  // Stacked layout: where the panel begins, and the year bar stuck above it.
  const panelAnchorRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const globeReadyRef = useRef(false)

  const cultures = useMemo(() => cultureRow(eras, songPlaces), [eras, songPlaces])
  // The daily journey always opens playing: only eras with real songs.
  const featuredPool = useMemo(
    () => eras.filter((era) => era.playable >= MIN_FEATURED_PLAYABLE),
    [eras],
  )
  const cultureById = useMemo(() => {
    const map = new Map<string, Culture>()
    for (const era of eras) map.set(era.id, era)
    for (const place of songPlaces) map.set(place.id, place)
    return map
  }, [eras, songPlaces])
  const journey = journeyId ? (cultureById.get(journeyId) ?? null) : null
  // The globe captures its ready callback once, at init — it reads the
  // journey through this ref, never a stale closure.
  const journeyRef = useRef<Culture | null>(null)
  useEffect(() => {
    journeyRef.current = journey
  }, [journey])
  const highlight =
    journey && !selected && !artist
      ? { code: journey.code, name: journey.place }
      : null

  // On a stacked layout the panel opens BELOW the year bar, so a place
  // opened from the globe, the search or a surprise would appear
  // off-screen. Bring its top to just under the stuck year bar. Wider
  // screens show the panel beside the globe and need no scroll.
  const [scrollKey, setScrollKey] = useState<string | null>(null)
  const openKey = artist
    ? `a:${artist.mbid}`
    : selected
      ? `c:${selected.code}`
      : scrollKey
  useEffect(() => {
    if (!openKey) return
    if (!window.matchMedia(STACKED_QUERY).matches) return
    const frame = requestAnimationFrame(() => {
      const anchor = panelAnchorRef.current
      const controls = controlsRef.current
      if (!anchor) return
      const navHeight =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--nav-h'),
        ) || 56
      const stuckAbove = controls ? controls.getBoundingClientRect().height : 0
      const top =
        anchor.getBoundingClientRect().top +
        window.scrollY -
        (navHeight + stuckAbove + 12)
      window.scrollTo({ top, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [openKey])

  useEffect(
    () => () => {
      if (yearTween.current) clearInterval(yearTween.current)
    },
    [],
  )

  // Panels follow the year only once it settles.
  useEffect(() => {
    const timer = setTimeout(() => setPanelYear(year), 350)
    return () => clearTimeout(timer)
  }, [year])

  // Crash self-reporting (mobile slider deaths were invisible): uncaught
  // errors and unhandled rejections beacon to /api/postcard, rate-limited
  // so an error loop can't storm the endpoint.
  useEffect(() => {
    let lastBeacon = 0
    const beacon = (reason: string, detail: unknown) => {
      const now = Date.now()
      if (now - lastBeacon < 5000) return
      lastBeacon = now
      void import('@/lib/clientLog').then(({ reportClientError }) =>
        reportClientError('uncaught', reason, detail),
      )
    }
    const onError = (event: ErrorEvent) =>
      beacon(event.message || 'uncaught error', event.error)
    const onRejection = (event: PromiseRejectionEvent) =>
      beacon('unhandled rejection', event.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  /** Slide the year readout to its destination, then fire the landing. */
  const tweenYearTo = useCallback(
    (from: number, target: number, onArrive: () => void) => {
      if (yearTween.current) clearInterval(yearTween.current)
      const distance = target - from
      if (distance === 0) {
        onArrive()
        return
      }
      // Reduced motion: land at once, no sliding readout.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setYear(target)
        onArrive()
        return
      }
      const steps = 12
      let step = 0
      yearTween.current = setInterval(() => {
        step++
        if (step >= steps) {
          if (yearTween.current) clearInterval(yearTween.current)
          yearTween.current = null
          setYear(target)
          onArrive()
          return
        }
        setYear(Math.round(from + (distance * step) / steps))
      }, 45)
    },
    [],
  )

  async function onSurprise() {
    if (surpriseBusy) return
    setSurpriseBusy(true)
    try {
      const data = await loadSurpriseData()
      const target = pickSurprise(data, surpriseEras, surpriseSeen.current)
      if (!target) return
      surpriseSeen.current.add(`${target.code}:${target.year}`)
      setArtist(null)
      setSelected(null)
      setSpotlightKey(`${target.code}:${target.year}`)
      tweenYearTo(year, target.year, () => {
        // The panel opens NOW — no settle wait after a programmatic jump.
        setPanelYear(target.year)
        setFocusRequest((current) => ({
          code: target.code,
          name: target.name,
          nonce: (current?.nonce ?? 0) + 1,
        }))
      })
    } catch {
      // Data didn't load — the next tap retries from scratch.
    } finally {
      setSurpriseBusy(false)
    }
  }

  // The lens dataset is optional — absent file, hidden menu.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await loadGenreData()
      if (!cancelled && data) setGenreData(data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Read the shareable state once on mount: /?y=1969&c=JM&v=map&j=BR-…
  // Old range links (?from=1965&to=1975) migrate to their midpoint
  // year. Captured synchronously — the URL-writer effect below runs
  // right after this one and would otherwise wipe the params first.
  // (setState still runs from a timeout callback, not the effect body.)
  useEffect(() => {
    const search = window.location.search
    const timer = setTimeout(() => {
      const params = new URLSearchParams(search)
      const single = Number(params.get('y'))
      const from = Number(params.get('from'))
      const to = Number(params.get('to'))
      let yearFromUrl = false
      if (
        Number.isInteger(single) &&
        single >= YEAR_MIN &&
        single <= YEAR_MAX
      ) {
        setYear(single)
        setPanelYear(single)
        yearFromUrl = true
      } else if (
        Number.isInteger(from) &&
        Number.isInteger(to) &&
        from >= YEAR_MIN &&
        to <= YEAR_MAX &&
        from <= to
      ) {
        const migrated = Math.round((from + to) / 2)
        setYear(migrated)
        setPanelYear(migrated)
        yearFromUrl = true
      }
      const code = params.get('c')
      if (code && /^([A-Z]{2}(-[A-Z]{2,3})?|[a-z]{3,20})$/.test(code)) {
        // Uppercase = ISO country/region; lowercase = claimed-place id.
        pendingCountry.current = code
      }
      const genre = params.get('g')
      if (isGenreLens(genre)) setLens(genre)
      const requestedView = params.get('v')
      if (EXPLORE_VIEWS.includes(requestedView as ExploreView)) {
        setView(requestedView as ExploreView)
      }

      // The journey: a shared ?j= link, else today's pick.
      const linked = params.get('j')
      const chosen =
        (linked && cultureById.get(linked)) ||
        featuredPool[dailyIndex(featuredPool.length)] ||
        null
      if (chosen) {
        setJourneyId(chosen.id)
        if (linked && chosen.id === linked) setJourneyPinned(true)
        // A plain visit opens on the journey's own era, so the slider and
        // the panel tell the same story. A shared year always wins.
        if (!yearFromUrl && !code && chosen.kind === 'era') {
          setYear(eraYear(chosen))
          setPanelYear(eraYear(chosen))
        }
        // A globe that beat this timeout turns now; otherwise it turns
        // when it reports ready.
        if (!code && globeReadyRef.current) faceCulture(chosen)
      }

      if (params.get('focus') === 'search') {
        document.getElementById(EXPLORE_SEARCH_ID)?.focus()
      }
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL once
  }, [])

  // Keep the URL shareable: year, open place, view, lens and a chosen
  // journey survive reload and paste. DEBOUNCED and guarded: iOS Safari
  // THROWS when replaceState exceeds ~100 calls/30s — the per-tick
  // writes during fast slider drags were killing the page outright
  // (mobile crash report, Aug 2026).
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (year !== DEFAULT_YEAR) params.set('y', String(year))
      if (selected) params.set('c', selected.code)
      if (lens) params.set('g', lens)
      if (view !== 'globe') params.set('v', view)
      if (journeyPinned && journeyId) params.set('j', journeyId)
      if (noGlobe) params.set('noglobe', '1')
      const query = params.toString()
      try {
        window.history.replaceState(null, '', query ? `/?${query}` : '/')
      } catch (error) {
        void import('@/lib/clientLog').then(({ reportClientError }) =>
          reportClientError(
            'url-write',
            'replaceState refused (rate limit?)',
            error,
          ),
        )
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [year, selected, lens, view, journeyPinned, journeyId, noGlobe])

  function onSearchResolved(
    result: Exclude<SearchChoice, { kind: 'roster' }>,
  ) {
    if (result.kind === 'artist') {
      setSelected(null)
      setArtist(result.artist)
      return
    }
    setArtist(null)
    setFocusRequest({
      code: result.country,
      name: result.area,
      nonce: (focusRequest?.nonce ?? 0) + 1,
    })
  }

  /** Turn the globe toward a culture's place, without opening it. */
  function faceCulture(culture: Culture) {
    setFocusRequest((current) => ({
      code: culture.code,
      name: culture.place,
      nonce: (current?.nonce ?? 0) + 1,
      flyOnly: true,
    }))
  }

  function onGlobeReady(dataSource: DataSource) {
    setSource(dataSource)
    globeReadyRef.current = true
    // The globe can now fly — honor a deep-linked country exactly once.
    if (pendingCountry.current) {
      setFocusRequest({
        code: pendingCountry.current,
        name: pendingCountry.current,
        nonce: (focusRequest?.nonce ?? 0) + 1,
      })
      pendingCountry.current = null
    } else if (journeyRef.current) {
      faceCulture(journeyRef.current)
    }
  }

  /** A culture card, a link or "Another journey": feature it. */
  function featureCulture(culture: Culture) {
    setArtist(null)
    setSelected(null)
    setJourneyId(culture.id)
    setJourneyPinned(true)
    setScrollKey(`j:${culture.id}:${Date.now()}`)
    if (culture.kind === 'era') {
      tweenYearTo(year, eraYear(culture), () => setPanelYear(eraYear(culture)))
    }
    faceCulture(culture)
  }

  function nextJourney() {
    if (featuredPool.length === 0) return
    const at = featuredPool.findIndex((era) => era.id === journeyId)
    featureCulture(featuredPool[(at + 1) % featuredPool.length])
  }

  /** "Open on the globe": the place's full panel, at the era's year. */
  function openCulturePlace(culture: Culture) {
    if (culture.kind === 'era') {
      const target = eraYear(culture)
      setYear(target)
      setPanelYear(target)
    }
    setArtist(null)
    setFocusRequest((current) => ({
      code: culture.code,
      name: culture.place,
      nonce: (current?.nonce ?? 0) + 1,
    }))
  }

  function onCountryClick(country: SelectedCountry) {
    setArtist(null)
    setSelected(country)
  }

  const viewHint =
    view === 'globe'
      ? 'Drag to spin · scroll to zoom · click a country or search a place'
      : view === 'map'
        ? 'Click a country, or search any city, country or artist'
        : 'Pick a country, or search any city or artist'

  return (
    <div className={styles.explore}>
      <div className={styles.hero}>
        <p className={styles.overline}>Music without borders</p>
        <h1 className={styles.title}>Where will music take you?</h1>
        <p className={styles.subtitle}>
          Pick a place. Choose an era. Find your next favorite.
        </p>
        <div className={styles.searchRow}>
          <SearchBox
            onResolved={onSearchResolved}
            trailing={
              // One tap, one place+year worth landing on. What it does
              // stays a surprise until clicked.
              <button
                type="button"
                className={styles.surprise}
                onClick={onSurprise}
                disabled={surpriseBusy}
                aria-label="Surprise me — fly somewhere unexpected"
              >
                <span
                  className={surpriseBusy ? styles.surpriseIconBusy : undefined}
                  aria-hidden="true"
                >
                  <Icon name="shuffle" size={18} />
                </span>
                <span className={styles.surpriseLabel}>Surprise me</span>
              </button>
            }
          />
        </div>
        <div className={styles.viewRow}>
          <ViewSwitch
            view={view}
            onChange={setView}
            globeUnavailable={globeUnavailable}
          />
        </div>
      </div>

      <div className={styles.view} data-view={view}>
        <div
          className={`${styles.globeLayer} ${view === 'globe' ? '' : styles.layerHidden}`}
          aria-hidden={view !== 'globe' ? true : undefined}
        >
          <GlobeScene
            forceFallback={noGlobe}
            year={year}
            lens={
              lens && genreData?.genres[lens]
                ? { label: lens, countries: genreData.genres[lens] }
                : null
            }
            paused={selected !== null || artist !== null || highlight !== null}
            focusRequest={focusRequest}
            selected={selected}
            highlight={highlight}
            hidden={view !== 'globe'}
            onDataSourceChange={onGlobeReady}
            onCountryClick={onCountryClick}
            onUnavailable={() => {
              setGlobeUnavailable(true)
              // Hand the visitor the flat map rather than a fallback note.
              if (!noGlobe) setView((current) => (current === 'globe' ? 'map' : current))
            }}
          />
        </div>
        {view === 'map' && (
          <div className={styles.altView}>
            <FlatMap
              year={year}
              selected={selected}
              highlight={highlight}
              onCountryClick={onCountryClick}
            />
          </div>
        )}
        {view === 'list' && (
          <div className={styles.altView}>
            <CountryList
              year={year}
              selected={selected}
              onCountryClick={onCountryClick}
            />
          </div>
        )}
        {lens && view !== 'list' && <GenreStory key={lens} genre={lens} />}
      </div>

      <div ref={controlsRef} className={styles.time}>
        <YearSlider
          year={year}
          min={YEAR_MIN}
          max={YEAR_MAX}
          onChange={setYear}
        />
        <div className={styles.timeMeta}>
          <p className={styles.caption}>
            {source && (
              <span>
                {lens
                  ? `${lens} lens — where artists emerged, by decade`
                  : source === 'live'
                    ? 'MusicBrainz release data'
                    : 'Simulated preview data — the real dataset is precomputing'}
              </span>
            )}
            <span className={styles.hint}>{viewHint}</span>
          </p>
          {genreData && (
            <div className={styles.lens}>
              <button
                type="button"
                className={styles.lensToggle}
                onClick={() => setLensOpen((open) => !open)}
                aria-expanded={lensOpen}
                aria-controls="explore-genre-menu"
              >
                Genre: {lens ?? 'All music'}
                <Icon name="chevronDown" size={14} />
              </button>
              <div
                id="explore-genre-menu"
                className={styles.lensMenu}
                hidden={!lensOpen}
              >
                <button
                  type="button"
                  className={lens === null ? styles.lensPillActive : styles.lensPill}
                  onClick={() => {
                    setLens(null)
                    setLensOpen(false)
                  }}
                >
                  All music
                </button>
                {Object.keys(genreData.genres).map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    className={
                      lens === genre ? styles.lensPillActive : styles.lensPill
                    }
                    onClick={() => {
                      setLens(isGenreLens(genre) ? genre : null)
                      setLensOpen(false)
                    }}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={panelAnchorRef} className={styles.panelSlot}>
        {artist ? (
          <ArtistEraPanel
            key={`${artist.mbid}:${panelYear}`}
            artist={artist}
            year={panelYear}
            onClose={() => setArtist(null)}
          />
        ) : selected ? (
          <CountryPanel
            key={`${selected.code}:${panelYear}:${lens ?? ''}`}
            country={selected}
            year={panelYear}
            genre={lens}
            source={source}
            roster={roster}
            spotlight={spotlightKey === `${selected.code}:${panelYear}`}
            onClose={() => setSelected(null)}
          />
        ) : journey ? (
          <JourneyPanel
            key={journey.id}
            culture={journey}
            onOpenPlace={openCulturePlace}
            onNext={featuredPool.length > 1 ? nextJourney : undefined}
          />
        ) : (
          <div className={styles.panelPlaceholder} aria-hidden="true" />
        )}
      </div>

      {cultures.length > 0 && (
        <div className={styles.cultures}>
          <MusicCultures
            cultures={cultures}
            currentId={!selected && !artist ? journeyId : null}
            onSelect={featureCulture}
          />
        </div>
      )}
    </div>
  )
}
