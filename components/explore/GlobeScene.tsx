'use client'

import { useEffect, useRef, useState } from 'react'
import type { GlobeInstance } from 'globe.gl'
import { reportClientError } from '@/lib/clientLog'
import {
  bandedHeat,
  countInRange,
  heatColor,
  heatValue,
  loadCounts,
  loadStateCounts,
  maxForRange,
  type CountryYearCounts,
  type DataSource,
} from '@/lib/explore/counts'
import {
  US_STATES,
  US_STATE_CODE_PATTERN,
  usStateByCode,
} from '@/lib/explore/states'
import {
  genreCountInRange,
  genreMaxForRange,
  type GenreCountryDecades,
} from '@/lib/explore/genreData'
import {
  featureCode,
  isoOf,
  roughCentroid,
  type CountryFeature,
} from '@/lib/explore/geo'
import {
  SUBDIVISION_CODE_PATTERN,
  splitSubdivisionFeatures,
} from '@/lib/explore/subdivisions'
import type { SelectedCountry } from '@/components/explore/CountryPanel'
import styles from './GlobeScene.module.css'

/**
 * Zoom decides what the United States is: a country from afar, fifty
 * states up close. Crossing STATE_ZOOM_ENTER swaps the US polygon for
 * the state layer; zooming back past STATE_ZOOM_EXIT restores the
 * country. The gap is hysteresis so the border never flaps.
 */
const STATE_ZOOM_ENTER = 1.15
const STATE_ZOOM_EXIT = 1.3
/** Fly-to altitude for a state — below ENTER so the layer lights up. */
const STATE_FLY_ALTITUDE = 0.95

const SIDE_COLOR = 'rgba(242, 169, 59, 0.03)'
const STROKE_COLOR = 'rgba(242, 169, 59, 0.35)'
// Hot neighbors need a dark seam between their gold fills; cool
// countries keep the translucent gold wireframe against the dark sea.
const HOT_STROKE_COLOR = 'rgba(20, 14, 9, 0.95)'
const HOT_STROKE_THRESHOLD = 3 / 7
const SPHERE_COLOR = '#1b1613'
const ATMOSPHERE_COLOR = '#f2a93b'

export interface FocusRequest {
  code: string
  name: string
  nonce: number
}

/** The globe couldn't render — explore continues without it. */
interface GlobeFallback {
  reason: 'webgl-unsupported' | 'globe-init-failed' | 'dataset-fetch-failed'
  countries: { code: string; name: string }[]
}

function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      canvas.getContext('webgl2') ?? canvas.getContext('webgl'),
    )
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The countries dataset, with backoff retries. Later attempts add a
 * cache-busting query so a poisoned browser/proxy cache of the static
 * asset can't make the failure permanent.
 */
async function fetchCountries(): Promise<{ features: CountryFeature[] }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bust = attempt > 1 ? `?retry=${attempt}` : ''
      const res = await fetch(`/data/countries-110m.geojson${bust}`)
      if (!res.ok) throw new Error(`countries geojson: HTTP ${res.status}`)
      return (await res.json()) as { features: CountryFeature[] }
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(800 * attempt)
    }
  }
  throw lastError
}

interface LensState {
  label: string
  countries: GenreCountryDecades
}

interface GlobeSceneProps {
  /** Skip WebGL entirely and render the country-list fallback. */
  forceFallback?: boolean
  year: number
  /** Active genre lens — null shows the release heat map. */
  lens: LensState | null
  paused: boolean
  focusRequest: FocusRequest | null
  onDataSourceChange: (source: DataSource) => void
  onCountryClick: (country: SelectedCountry) => void
}

export function GlobeScene({
  forceFallback = false,
  year,
  lens,
  paused,
  focusRequest,
  onDataSourceChange,
  onCountryClick,
}: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState<GlobeFallback | null>(null)
  const globeRef = useRef<GlobeInstance | null>(null)
  const countsRef = useRef<CountryYearCounts>({})
  // Single selected year, kept as a [year, year] span so the heat and
  // count helpers (span-capable, still used by the panel widen) apply.
  const rangeRef = useRef<[number, number]>([year, year])
  const lensRef = useRef<LensState | null>(lens)
  const rangeMaxCache = useRef<Record<string, number>>({})
  const hoverRef = useRef<object | null>(null)
  const featureByCode = useRef<Map<string, CountryFeature>>(new Map())
  const pausedRef = useRef(paused)
  const cursorOverGlobeRef = useRef(false)
  // The zoomed-in US state layer: features + heat load lazily on the
  // first threshold crossing; the view swap rides globe.gl's onZoom.
  const countryViewRef = useRef<CountryFeature[]>([])
  const stateViewRef = useRef<CountryFeature[] | null>(null)
  const stateCountsRef = useRef<CountryYearCounts>({})
  const statesPromiseRef = useRef<Promise<boolean> | null>(null)
  const viewModeRef = useRef<'countries' | 'states'>('countries')
  const altitudeRef = useRef(2.1)

  function syncRotation() {
    const globe = globeRef.current
    if (globe) {
      globe.controls().autoRotate =
        !pausedRef.current && !cursorOverGlobeRef.current
    }
  }

  useEffect(() => {
    rangeRef.current = [year, year]
    lensRef.current = lens
    rangeMaxCache.current = {}
    applyHeat(globeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyHeat reads only refs; re-run on inputs alone
  }, [year, lens])

  useEffect(() => {
    pausedRef.current = paused
    syncRotation()
     
  }, [paused])

  // Search resolution: fly to the country (when we have its shape) and open it.
  useEffect(() => {
    if (!focusRequest) return
    const { code } = focusRequest
    // A state resolves like a country, but the fly-to dips below the
    // state-layer threshold so the state itself lights up. The panel
    // opens immediately; the camera follows when the layer is ready.
    // (Carved offshore subdivisions — Hawaii — already have features.)
    if (US_STATE_CODE_PATTERN.test(code) && !featureByCode.current.has(code)) {
      onCountryClick({
        code,
        name: usStateByCode(code)?.name ?? focusRequest.name,
      })
      void ensureStates().then((ready) => {
        const globe = globeRef.current
        const feature = featureByCode.current.get(code)
        if (!ready || !globe || !feature) return
        const { lat, lng } = roughCentroid(feature)
        globe.pointOfView({ lat, lng, altitude: STATE_FLY_ALTITUDE }, 650)
      })
      return
    }
    const globe = globeRef.current
    const feature = featureByCode.current.get(code)
    if (globe && feature) {
      const { lat, lng } = roughCentroid(feature)
      const isState = US_STATE_CODE_PATTERN.test(code)
      globe.pointOfView(
        { lat, lng, altitude: isState ? STATE_FLY_ALTITUDE : 1.7 },
        650,
      )
      onCountryClick({
        code,
        name: feature.properties.ADMIN,
      })
    } else {
      onCountryClick({ code, name: focusRequest.name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire per resolved search only
  }, [focusRequest])

  /**
   * Loads the state features + emergence counts once; resolves true
   * when the layer is ready. Failures resolve false and are retried on
   * the next call (transient network trouble shouldn't disable states
   * for the whole session).
   */
  function ensureStates(): Promise<boolean> {
    if (stateViewRef.current) return Promise.resolve(true)
    if (statesPromiseRef.current) return statesPromiseRef.current
    const promise = (async () => {
      try {
        const [geoRes, counts] = await Promise.all([
          fetch('/data/us-states-110m.geojson'),
          loadStateCounts(),
        ])
        if (!geoRes.ok) throw new Error(`states geojson: HTTP ${geoRes.status}`)
        const geo = (await geoRes.json()) as { features: CountryFeature[] }
        stateCountsRef.current = counts
        // The state view: every non-US feature (the carved Hawaii
        // included — the states file has its own) plus the 51 states.
        stateViewRef.current = [
          ...countryViewRef.current.filter((feature) => {
            const { ISO_A2 } = feature.properties
            return ISO_A2 !== 'US' && !US_STATE_CODE_PATTERN.test(ISO_A2)
          }),
          ...geo.features,
        ]
        for (const feature of geo.features) {
          featureByCode.current.set(feature.properties.ISO_A2, feature)
        }
        rangeMaxCache.current = {}
        return true
      } catch (error) {
        reportClientError('globe-states', 'state layer failed to load', error)
        statesPromiseRef.current = null
        return false
      }
    })()
    statesPromiseRef.current = promise
    return promise
  }

  function applyViewMode(mode: 'countries' | 'states') {
    const globe = globeRef.current
    if (mode === viewModeRef.current || !globe) return
    if (mode === 'states' && !stateViewRef.current) return
    viewModeRef.current = mode
    globe.polygonsData(
      mode === 'states' ? stateViewRef.current! : countryViewRef.current,
    )
    applyHeat(globe)
  }

  function onZoomChange(altitude: number) {
    altitudeRef.current = altitude
    if (altitude < STATE_ZOOM_ENTER && viewModeRef.current === 'countries') {
      void ensureStates().then((ready) => {
        // Re-check after the async load — the user may have zoomed away.
        if (ready && altitudeRef.current < STATE_ZOOM_EXIT) {
          applyViewMode('states')
        }
      })
    } else if (
      altitude > STATE_ZOOM_EXIT &&
      viewModeRef.current === 'states'
    ) {
      applyViewMode('countries')
    }
  }

  function heatFor(feature: object): number {
    const props = (feature as CountryFeature).properties
    if (US_STATE_CODE_PATTERN.test(props.ISO_A2)) {
      // States glow by artist emergence, normalized across states only.
      if (lensRef.current) return 0
      const [start, end] = rangeRef.current
      const count = countInRange(
        stateCountsRef.current[props.ISO_A2],
        start,
        end,
      )
      const max = (rangeMaxCache.current[`s:${start}:${end}`] ??= maxForRange(
        stateCountsRef.current,
        start,
        end,
      ))
      return heatValue(count, max)
    }
    const code = isoOf(feature as CountryFeature)
    if (!code) return 0
    const [start, end] = rangeRef.current
    const activeLens = lensRef.current
    if (activeLens) {
      const count = genreCountInRange(activeLens.countries[code], start, end)
      const max = (rangeMaxCache.current[`g:${start}:${end}`] ??=
        genreMaxForRange(activeLens.countries, start, end))
      return heatValue(count, max)
    }
    const count = countInRange(countsRef.current[code], start, end)
    const max = (rangeMaxCache.current[`${start}:${end}`] ??= maxForRange(
      countsRef.current,
      start,
      end,
    ))
    return heatValue(count, max)
  }

  function capColorFor(feature: object): string {
    return heatColor(bandedHeat(heatFor(feature)), feature === hoverRef.current)
  }

  function strokeColorFor(feature: object): string {
    return bandedHeat(heatFor(feature)) >= HOT_STROKE_THRESHOLD
      ? HOT_STROKE_COLOR
      : STROKE_COLOR
  }

  function applyHeat(globe: GlobeInstance | null) {
    if (!globe) return
    globe
      .polygonCapColor(capColorFor)
      .polygonStrokeColor(strokeColorFor)
      .polygonAltitude((feature) => 0.008 + heatFor(feature) * 0.05)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let globe: GlobeInstance | undefined
    let observer: ResizeObserver | undefined
    let disposed = false

    /**
     * Sorted clickable list for the non-globe fallback — with the 50
     * states (+ DC) slotted right after United States, since fallback
     * visitors have no zoom gesture to reveal them.
     */
    function countryList(
      features: CountryFeature[],
    ): { code: string; name: string }[] {
      const countries = features
        .flatMap((feature) => {
          const code = featureCode(feature)
          return code && !US_STATE_CODE_PATTERN.test(code)
            ? [{ code, name: feature.properties.ADMIN }]
            : []
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      const usIndex = countries.findIndex((entry) => entry.code === 'US')
      if (usIndex === -1) return countries
      const states = [...US_STATES]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((state) => ({ code: state.code, name: `US · ${state.name}` }))
      countries.splice(usIndex + 1, 0, ...states)
      return countries
    }

    async function init(mount: HTMLDivElement) {
      // The dataset first — even the non-globe fallback needs the
      // country names, and its fetch retries with cache-busting.
      let countries: { features: CountryFeature[] }
      try {
        countries = await fetchCountries()
      } catch (error) {
        if (disposed) return
        reportClientError(
          'globe-dataset',
          'countries geojson failed after retries',
          error,
        )
        setFallback({ reason: 'dataset-fetch-failed', countries: [] })
        return
      }
      if (disposed) return

      // Configured subdivisions (Hawaii) become their own clickable
      // features, split out of the parent country's polygons.
      const features = splitSubdivisionFeatures(
        countries.features as CountryFeature[],
      )
      countries.features = features
      countryViewRef.current = features

      // No WebGL (hardware acceleration off, GPU blocklisted, remote
      // desktop) is PERSISTENT — reloading never helps. Skip straight
      // to the functional fallback. ?noglobe=1 forces it for testing
      // and for visitors on weak devices.
      const forced = forceFallback
      if (forced || !webglSupported()) {
        if (!forced) {
          reportClientError('globe-webgl', 'WebGL unavailable on this device')
        }
        setFallback({
          reason: 'webgl-unsupported',
          countries: countryList(features),
        })
        // Panel data is still live MusicBrainz — and announcing frees
        // any deep-linked ?c= country to open in fallback mode too.
        onDataSourceChange('live')
        return
      }

      let Globe: typeof import('globe.gl').default
      try {
        Globe = (await import('globe.gl')).default
      } catch (error) {
        if (disposed) return
        reportClientError('globe-chunk', 'globe.gl chunk failed to load', error)
        setFallback({
          reason: 'globe-init-failed',
          countries: countryList(features),
        })
        onDataSourceChange('live')
        return
      }
      if (disposed) return
      featureByCode.current = new Map(
        features.flatMap((feature) => {
          const code = featureCode(feature)
          return code ? [[code, feature] as const] : []
        }),
      )
      const codes = [...featureByCode.current.keys()]
      const { counts, source } = await loadCounts(codes)
      if (disposed) return
      countsRef.current = counts
      rangeMaxCache.current = {}

      globe = new Globe(mount)
        .backgroundColor('rgba(0,0,0,0)')
        .showGraticules(false)
        .atmosphereColor(ATMOSPHERE_COLOR)
        .atmosphereAltitude(0.14)
        .polygonsData(countries.features)
        .polygonSideColor(() => SIDE_COLOR)
        .polygonStrokeColor(strokeColorFor)
        .polygonsTransitionDuration(150)
        .polygonLabel((feature) => {
          const props = (feature as CountryFeature).properties
          const code = isoOf(feature as CountryFeature)
          const [start, end] = rangeRef.current
          const span = start === end ? `${start}` : `${start}–${end}`
          if (SUBDIVISION_CODE_PATTERN.test(props.ISO_A2)) {
            // States: artist-emergence counts from the precomputed
            // dataset; lens mode and count-less regions invite the click.
            const emerged = lensRef.current
              ? 0
              : countInRange(
                  stateCountsRef.current[props.ISO_A2],
                  rangeRef.current[0],
                  rangeRef.current[1],
                )
            const detail =
              emerged > 0
                ? `${emerged.toLocaleString()} artists emerged here · ${span}`
                : `its own scene — click for artists · ${span}`
            return `<div class="globe-tooltip"><span class="globe-tooltip-name">${props.ADMIN}</span><span class="globe-tooltip-count">${detail}</span></div>`
          }
          const activeLens = lensRef.current
          if (activeLens) {
            const count = code
              ? genreCountInRange(activeLens.countries[code], start, end)
              : 0
            return `<div class="globe-tooltip"><span class="globe-tooltip-name">${props.ADMIN}</span><span class="globe-tooltip-count">${count.toLocaleString()} ${activeLens.label} artists emerged · ${span}</span></div>`
          }
          const count = code
            ? countInRange(countsRef.current[code], start, end)
            : 0
          // The US carries a second life at close zoom — say so.
          const stateHint =
            code === 'US'
              ? '<span class="globe-tooltip-count">zoom in for the fifty states</span>'
              : ''
          return `<div class="globe-tooltip"><span class="globe-tooltip-name">${props.ADMIN}</span><span class="globe-tooltip-count">${count.toLocaleString()} releases · ${span}</span>${stateHint}</div>`
        })
        .onPolygonHover((hovered) => {
          hoverRef.current = hovered ?? null
          if (globe) applyHeat(globe)
          mount.style.cursor = hovered ? 'pointer' : 'grab'
        })
        .onPolygonClick((clicked) => {
          const feature = clicked as CountryFeature
          const code = featureCode(feature)
          if (!code || !globe) return
          const { lat, lng } = roughCentroid(feature)
          // State clicks stay below the layer threshold — flying out
          // to country altitude would swap the states away mid-open.
          const altitude = US_STATE_CODE_PATTERN.test(code)
            ? Math.min(altitudeRef.current, STATE_FLY_ALTITUDE)
            : 1.7
          globe.pointOfView({ lat, lng, altitude }, 650)
          onCountryClick({ code, name: feature.properties.ADMIN })
        })
        .onZoom((pov) => onZoomChange(pov.altitude))
        .width(mount.clientWidth)
        .height(mount.clientHeight)

      globe.globeMaterial().color.set(SPHERE_COLOR)
      globe.pointOfView({ lat: 24, lng: -30, altitude: 2.1 }, 0)
      applyHeat(globe)
      globeRef.current = globe
      // Announced only once the globe can act on focus requests — URL
      // deep links (?c=JM) rely on this ordering to fly the camera.
      onDataSourceChange(source)

      if (process.env.NODE_ENV === 'development') {
        ;(window as unknown as Record<string, unknown>).__earclefGlobe = globe
      }

      const controls = globe.controls()
      controls.autoRotateSpeed = 0.45
      controls.enablePan = false
      controls.minDistance = 160
      controls.maxDistance = 480
      syncRotation()

      // Chasing small countries on a spinning globe is maddening —
      // rest the cursor on the globe and it holds still.
      mount.addEventListener('pointerenter', () => {
        cursorOverGlobeRef.current = true
        syncRotation()
      })
      mount.addEventListener('pointerleave', () => {
        cursorOverGlobeRef.current = false
        syncRotation()
      })

      observer = new ResizeObserver(() => {
        globe?.width(mount.clientWidth).height(mount.clientHeight)
      })
      observer.observe(mount)
    }

    // Anything the staged handlers above didn't catch — most likely
    // WebGL context creation throwing inside new Globe() even though
    // the capability probe passed (context limits, driver failures).
    init(el).catch((error: unknown) => {
      if (disposed) return
      reportClientError('globe-init', 'globe construction failed', error)
      setFallback({
        reason: 'globe-init-failed',
        countries: [...featureByCode.current.entries()]
          .map(([code, feature]) => ({
            code,
            name: feature.properties.ADMIN,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })
      onDataSourceChange('live')
    })

    return () => {
      disposed = true
      observer?.disconnect()
      globeRef.current = null
      globe?._destructor()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; year updates flow through refs
  }, [])

  if (fallback) {
    return (
      <div className={`${styles.scene} ${styles.fallback}`}>
        <p className={styles.fallbackNote}>
          {fallback.reason === 'dataset-fetch-failed'
            ? 'The map data would not load here — but the search above still finds any city, country, or artist.'
            : "This device can't render the 3D globe — no matter: pick a country below or use the search above."}
        </p>
        {fallback.countries.length > 0 && (
          <ul className={styles.fallbackList}>
            {fallback.countries.map((country) => (
              <li key={country.code}>
                <button
                  type="button"
                  className={styles.fallbackCountry}
                  onClick={() => onCountryClick(country)}
                >
                  {country.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return <div ref={containerRef} className={styles.scene} />
}
