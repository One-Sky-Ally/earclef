'use client'

import { useEffect, useRef } from 'react'
import type { GlobeInstance } from 'globe.gl'
import {
  heatValue,
  loadCounts,
  maxForYear,
  type CountryYearCounts,
  type DataSource,
} from '@/lib/explore/counts'
import { isoOf, type CountryFeature } from '@/lib/explore/geo'
import styles from './GlobeScene.module.css'

const SIDE_COLOR = 'rgba(242, 169, 59, 0.03)'
const STROKE_COLOR = 'rgba(242, 169, 59, 0.35)'
const SPHERE_COLOR = '#1b1613'
const ATMOSPHERE_COLOR = '#f2a93b'

interface GlobeSceneProps {
  year: number
  onDataSourceChange: (source: DataSource) => void
}

export function GlobeScene({ year, onDataSourceChange }: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeInstance | null>(null)
  const countsRef = useRef<CountryYearCounts>({})
  const yearRef = useRef(year)
  const yearMaxCache = useRef<Record<number, number>>({})
  const hoverRef = useRef<object | null>(null)

  useEffect(() => {
    yearRef.current = year
    applyHeat(globeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyHeat reads only refs; re-run on year alone
  }, [year])

  function heatFor(feature: object): number {
    const code = isoOf(feature as CountryFeature)
    if (!code) return 0
    const activeYear = yearRef.current
    const count = countsRef.current[code]?.[activeYear] ?? 0
    const max = (yearMaxCache.current[activeYear] ??= maxForYear(
      countsRef.current,
      activeYear,
    ))
    return heatValue(count, max)
  }

  function capColorFor(feature: object): string {
    const heat = heatFor(feature)
    const hovered = feature === hoverRef.current
    const alpha = Math.min(0.05 + heat * 0.6 + (hovered ? 0.25 : 0), 0.92)
    return `rgba(242, 169, 59, ${alpha.toFixed(3)})`
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

      const codes = (countries.features as CountryFeature[])
        .map(isoOf)
        .filter((code): code is string => Boolean(code))
      const { counts, source } = await loadCounts(codes)
      if (disposed) return
      countsRef.current = counts
      yearMaxCache.current = {}
      onDataSourceChange(source)

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
          const count = code
            ? (countsRef.current[code]?.[yearRef.current] ?? 0)
            : 0
          return `<span class="globe-tooltip"><strong>${props.ADMIN}</strong><br/>${count.toLocaleString()} releases · ${yearRef.current}</span>`
        })
        .onPolygonHover((hovered) => {
          hoverRef.current = hovered ?? null
          if (globe) applyHeat(globe)
          mount.style.cursor = hovered ? 'pointer' : 'grab'
        })
        .width(mount.clientWidth)
        .height(mount.clientHeight)

      globe.globeMaterial().color.set(SPHERE_COLOR)
      globe.pointOfView({ lat: 24, lng: -30, altitude: 2.1 }, 0)
      applyHeat(globe)
      globeRef.current = globe

      const controls = globe.controls()
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.45
      controls.enablePan = false
      controls.minDistance = 160
      controls.maxDistance = 480

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
