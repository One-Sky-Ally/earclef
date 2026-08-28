'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { EarClefMark } from '@/components/EarClefMark'
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
import type { SearchResult } from '@/lib/explore/panelData'
import type { FocusRequest } from '@/components/explore/GlobeScene'
import { YearSlider } from '@/components/explore/YearSlider'
import { SearchBox } from '@/components/explore/SearchBox'
import { GenreStory } from '@/components/explore/GenreStory'
import {
  ArtistEraPanel,
  type SelectedArtist,
} from '@/components/explore/ArtistEraPanel'
import {
  CountryPanel,
  type RosterByMbid,
  type SelectedCountry,
} from '@/components/explore/CountryPanel'
import styles from './ExploreClient.module.css'

const GlobeScene = dynamic(
  () => import('@/components/explore/GlobeScene').then((m) => m.GlobeScene),
  {
    ssr: false,
    loading: () => <p className={styles.loading}>Spinning up the world…</p>,
  },
)

interface ExploreClientProps {
  roster?: RosterByMbid
  /** Documented "What was playing" eras — the surprise picker's 30%. */
  surpriseEras?: SurpriseEra[]
}

export function ExploreClient({
  roster = {},
  surpriseEras = [],
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
  // Mobile: pills live in a collapsed menu so results stay visible.
  const [lensOpen, setLensOpen] = useState(false)
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

  // The lens dataset is optional — absent file, hidden pills.
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

  // Read the shareable state once on mount: /?y=1969&c=JM. Old range
  // links (?from=1965&to=1975) migrate to their midpoint year.
  // Captured synchronously — the URL-writer effect below runs right
  // after this one and would otherwise wipe the params first. (setState
  // still runs from a timeout callback, not the effect body.)
  useEffect(() => {
    const search = window.location.search
    const timer = setTimeout(() => {
      const params = new URLSearchParams(search)
      const single = Number(params.get('y'))
      const from = Number(params.get('from'))
      const to = Number(params.get('to'))
      if (
        Number.isInteger(single) &&
        single >= YEAR_MIN &&
        single <= YEAR_MAX
      ) {
        setYear(single)
        setPanelYear(single)
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
      }
      const code = params.get('c')
      if (code && /^([A-Z]{2}(-[A-Z]{2,3})?|[a-z]{3,20})$/.test(code)) {
        // Uppercase = ISO country/region; lowercase = claimed-place id.
        pendingCountry.current = code
      }
      const genre = params.get('g')
      if (isGenreLens(genre)) setLens(genre)
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Keep the URL shareable: year + open panel survive reload and paste.
  // DEBOUNCED and guarded: iOS Safari THROWS when replaceState exceeds
  // ~100 calls/30s — the per-tick writes during fast slider drags were
  // killing the page outright (mobile crash report, Aug 2026).
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (year !== DEFAULT_YEAR) params.set('y', String(year))
      if (selected) params.set('c', selected.code)
      if (lens) params.set('g', lens)
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
  }, [year, selected, lens, noGlobe])

  function onSearchResolved(result: SearchResult) {
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

  function onGlobeReady(dataSource: DataSource) {
    setSource(dataSource)
    // The globe can now fly — honor a deep-linked country exactly once.
    if (pendingCountry.current) {
      setFocusRequest({
        code: pendingCountry.current,
        name: pendingCountry.current,
        nonce: (focusRequest?.nonce ?? 0) + 1,
      })
      pendingCountry.current = null
    }
  }

  return (
    <div className={styles.stage}>
      <GlobeScene
        forceFallback={noGlobe}
        year={year}
        lens={
          lens && genreData?.genres[lens]
            ? { label: lens, countries: genreData.genres[lens] }
            : null
        }
        paused={selected !== null || artist !== null}
        focusRequest={focusRequest}
        onDataSourceChange={onGlobeReady}
        onCountryClick={(country) => {
          setArtist(null)
          setSelected(country)
        }}
      />
      <SearchBox onResolved={onSearchResolved} />
      {/* One tap, one place+year worth landing on. What it does stays
          a surprise until clicked — the label only names the promise. */}
      <button
        type="button"
        className={styles.surprise}
        onClick={onSurprise}
        disabled={surpriseBusy}
        aria-label="Surprise me — fly somewhere unexpected"
      >
        <span
          className={
            surpriseBusy ? styles.surpriseMarkSpinning : styles.surpriseMark
          }
          aria-hidden="true"
        >
          <EarClefMark size={38} />
        </span>
        <span className={styles.surpriseLabel}>Surprise me</span>
      </button>
      {lens && <GenreStory key={lens} genre={lens} />}
      {artist && (
        <ArtistEraPanel
          key={`${artist.mbid}:${panelYear}`}
          artist={artist}
          year={panelYear}
          onClose={() => setArtist(null)}
        />
      )}
      {selected && !artist && (
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
      )}
      <div
        className={`${styles.controls} ${
          selected || artist ? styles.controlsBehindPanel : ''
        }`}
      >
        {genreData && (
          <>
            <button
              type="button"
              className={styles.lensToggle}
              onClick={() => setLensOpen((open) => !open)}
              aria-expanded={lensOpen}
            >
              ♪ {lens ?? 'All music'}
              <span aria-hidden="true"> {lensOpen ? '▾' : '▸'}</span>
            </button>
            <div className={lensOpen ? styles.lensRowOpen : styles.lensRow}>
              <button
                type="button"
                className={
                  lens === null ? styles.lensPillActive : styles.lensPill
                }
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
          </>
        )}
        <YearSlider
          year={year}
          min={YEAR_MIN}
          max={YEAR_MAX}
          onChange={setYear}
        />
        {source && (
          <p className={styles.source}>
            {lens
              ? `${lens} lens — where artists emerged, by decade`
              : source === 'live'
                ? 'MusicBrainz release data'
                : 'Simulated preview data — the real dataset is precomputing'}
          </p>
        )}
      </div>
    </div>
  )
}
