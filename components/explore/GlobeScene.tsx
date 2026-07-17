'use client'

import { useEffect, useRef } from 'react'
import type { GlobeInstance } from 'globe.gl'
import {
  countInRange,
  heatColor,
  heatValue,
  loadCounts,
  maxForRange,
  type CountryYearCounts,
  type DataSource,
} from '@/lib/explore/counts'
import { isoOf, roughCentroid, type CountryFeature } from '@/lib/explore/geo'
import type { SelectedCountry } from '@/components/explore/CountryPanel'
import styles from './GlobeScene.module.css'

const SIDE_COLOR = 'rgba(242, 169, 59, 0.03)'
const STROKE_COLOR = 'rgba(242, 169, 59, 0.35)'
const SPHERE_COLOR = '#1b1613'
const ATMOSPHERE_COLOR = '#f2a93b'

export interface FocusRequest {
  code: string
  name: string
  nonce: number
}

interface GlobeSceneProps {
  yearStart: number
  yearEnd: number
  paused: boolean
  focusRequest: FocusRequest | null
  onDataSourceChange: (source: DataSource) => void
  onCountryClick: (country: SelectedCountry) => void
}

export function GlobeScene({
  yearStart,
  yearEnd,
  paused,
  focusRequest,
  onDataSourceChange,
  onCountryClick,
}: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeInstance | null>(null)
  const countsRef = useRef<CountryYearCounts>({})
  const rangeRef = useRef<[number, number]>([yearStart, yearEnd])
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
    applyHeat(globeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyHeat reads only refs; re-run on range alone
  }, [yearStart, yearEnd])

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
    const count = countInRange(countsRef.current[code], start, end)
    const max = (rangeMaxCache.current[`${start}:${end}`] ??= maxForRange(
      countsRef.current,
      start,
      end,
    ))
    return heatValue(count, max)
  }

  function capColorFor(feature: object): string {
    return heatColor(heatFor(feature), feature === hoverRef.current)
  }

  function applyHeat(globe: GlobeInstance | null) {
    if (!globe) return
    globe
      .polygonCapColor(capColorFor)
      .polygonAltitude((feature) => 0.008 + heatFor(feature) * 0.05)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let globe: GlobeInstance | undefined
    let observer: ResizeObserver | undefined
    let disposed = false

    async function init(mount: HTMLDivElement) {
      const [{ default: Globe }, countries] = await Promise.all([
        import('globe.gl'),
        fetch('/data/countries-110m.geojson').then((res) => {
          if (!res.ok) throw new Error(`countries geojson: HTTP ${res.status}`)
          return res.json()
        }),
      ])
      if (disposed) return

      const features = countries.features as CountryFeature[]
      featureByCode.current = new Map(
        features.flatMap((feature) => {
          const code = isoOf(feature)
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
        .polygonStrokeColor(() => STROKE_COLOR)
        .polygonsTransitionDuration(150)
        .polygonLabel((feature) => {
          const props = (feature as CountryFeature).properties
          const code = isoOf(feature as CountryFeature)
          const [start, end] = rangeRef.current
          const count = code
            ? countInRange(countsRef.current[code], start, end)
            : 0
          const span = start === end ? `${start}` : `${start}–${end}`
          return `<div class="globe-tooltip"><span class="globe-tooltip-name">${props.ADMIN}</span><span class="globe-tooltip-count">${count.toLocaleString()} releases · ${span}</span></div>`
        })
        .onPolygonHover((hovered) => {
          hoverRef.current = hovered ?? null
          if (globe) applyHeat(globe)
          mount.style.cursor = hovered ? 'pointer' : 'grab'
        })
        .onPolygonClick((clicked) => {
          const feature = clicked as CountryFeature
          const code = isoOf(feature)
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

    init(el).catch(() => {
      if (!disposed) {
        el.textContent = 'The globe failed to load — please refresh.'
        el.className = `${styles.scene} ${styles.error}`
      }
    })

    return () => {
      disposed = true
      observer?.disconnect()
      globeRef.current = null
      globe?._destructor()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; year updates flow through refs
  }, [])

  return <div ref={containerRef} className={styles.scene} />
}
