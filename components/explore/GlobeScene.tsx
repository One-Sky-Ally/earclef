'use client'

import { useEffect, useRef } from 'react'
import type { GlobeInstance } from 'globe.gl'
import styles from './GlobeScene.module.css'

const CAP_COLOR = 'rgba(242, 169, 59, 0.10)'
const CAP_HOVER_COLOR = 'rgba(242, 169, 59, 0.38)'
const SIDE_COLOR = 'rgba(242, 169, 59, 0.03)'
const STROKE_COLOR = 'rgba(242, 169, 59, 0.35)'
const SPHERE_COLOR = '#1b1613'
const ATMOSPHERE_COLOR = '#f2a93b'

interface CountryFeature {
  properties: { ADMIN: string; ISO_A2: string }
}

export function GlobeScene() {
  const containerRef = useRef<HTMLDivElement>(null)

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

      globe = new Globe(mount)
        .backgroundColor('rgba(0,0,0,0)')
        .showGraticules(false)
        .atmosphereColor(ATMOSPHERE_COLOR)
        .atmosphereAltitude(0.14)
        .polygonsData(countries.features)
        .polygonAltitude(0.008)
        .polygonCapColor(() => CAP_COLOR)
        .polygonSideColor(() => SIDE_COLOR)
        .polygonStrokeColor(() => STROKE_COLOR)
        .polygonsTransitionDuration(200)
        .polygonLabel(
          (feature) =>
            `<span class="globe-tooltip">${(feature as CountryFeature).properties.ADMIN}</span>`,
        )
        .onPolygonHover((hovered) => {
          if (!globe) return
          globe.polygonCapColor((d) =>
            d === hovered ? CAP_HOVER_COLOR : CAP_COLOR,
          )
          mount.style.cursor = hovered ? 'pointer' : 'grab'
        })
        .width(mount.clientWidth)
        .height(mount.clientHeight)

      globe.globeMaterial().color.set(SPHERE_COLOR)
      globe.pointOfView({ lat: 24, lng: -30, altitude: 2.1 }, 0)

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
      globe?._destructor()
    }
  }, [])

  return <div ref={containerRef} className={styles.scene} />
}
