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
  maxForRange,
  type CountryYearCounts,
  type DataSource,
} from '@/lib/explore/counts'
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
  yearStart: number
  yearEnd: number
  /** Active genre lens — null shows the release heat map. */
  lens: LensState | null
  paused: boolean
  focusRequest: FocusRequest | null
  onDataSourceChange: (source: DataSource) => void
  onCountryClick: (country: SelectedCountry) => void
}

export function GlobeScene({
  forceFallback = false,
  yearStart,
  yearEnd,
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
  const rangeRef = useRef<[number, number]>([yearStart, yearEnd])
  const lensRef = useRef<LensState | null>(lens)
  const rangeMaxCache = useRef<Record<string, number>>({})
  const hoverRef = useRef<object | null>(null)
  const featureByCode = useRef<Map<string, CountryFeature>>(new Map())
  const pausedRef = useRef(paused)
  const cursorOverGlobeRef = useRef(false)

  function syncRotation() {
    const globe = globeRef.current
    if (globe) {
      globe.controls().autoRotate =
        !pausedRef.current && !cursorOverGlobeRef.current
    }
  }

  useEffect(() => {
    rangeRef.current = [yearStart, yearEnd]
    lensRef.current = lens
    rangeMaxCache.current = {}
    applyHeat(globeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyHeat reads only refs; re-run on inputs alone
  }, [yearStart, yearEnd, lens])

  useEffect(() => {
    pausedRef.current = paused
    syncRotation()
     
  }, [paused])

  // Search resolution: fly to the country (when we have its shape) and open it.
  useEffect(() => {
    if (!focusRequest) return
    const globe = globeRef.current
    const feature = featureByCode.current.get(focusRequest.code)
    if (globe && feature) {
      const { lat, lng } = roughCentroid(feature)
      globe.pointOfView({ lat, lng, altitude: 1.7 }, 650)
      onCountryClick({
        code: focusRequest.code,
        name: feature.properties.ADMIN,
      })
    } else {
      onCountryClick({ code: focusRequest.code, name: focusRequest.name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire per resolved search only
  }, [focusRequest])

  function heatFor(feature: object): number {
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

    /** Sorted clickable list for the non-globe fallback. */
    function countryList(
      features: CountryFeature[],
    ): { code: string; name: string }[] {
      return features
        .flatMap((feature) => {
          const code = featureCode(feature)
          return code
            ? [{ code, name: feature.properties.ADMIN }]
            : []
        })
        .sort((a, b) => a.name.localeCompare(b.name))
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
            // No per-subdivision release counts — invite the click instead.
            return `<div class="globe-tooltip"><span class="globe-tooltip-name">${props.ADMIN}</span><span class="globe-tooltip-count">its own scene — click for artists · ${span}</span></div>`
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
          return `<div class="globe-tooltip"><span class="globe-tooltip-name">${props.ADMIN}</span><span class="globe-tooltip-count">${count.toLocaleString()} releases · ${span}</span></div>`
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
          globe.pointOfView({ lat, lng, altitude: 1.7 }, 650)
          onCountryClick({ code, name: feature.properties.ADMIN })
        })
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
