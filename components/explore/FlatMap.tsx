'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  bandedHeat,
  countInRange,
  heatColor,
  heatValue,
  maxForRange,
  type CountryYearCounts,
} from '@/lib/explore/counts'
import { featureCode, isoOf, type CountryFeature } from '@/lib/explore/geo'
import { loadCountryShapes, loadSharedCounts } from '@/lib/explore/worldData'
import type { SelectedCountry } from '@/components/explore/CountryPanel'
import styles from './FlatMap.module.css'

/**
 * The flat Map view — the same countries, heat and selection as the
 * globe, drawn as an SVG in the Equal Earth projection. It needs no
 * WebGL, so it is the first alternative when the 3D globe can't run.
 * Small places are easier to reach from the List view or the search.
 */

const SELECTED_FILL = 'rgba(228, 114, 106, 0.88)'

// Equal Earth (Šavrič, Patterson & Jenny, 2018).
const A1 = 1.340264
const A2 = -0.081106
const A3 = 0.000893
const A4 = 0.003796
const M = Math.sqrt(3) / 2
const SCALE = 100

function project(lng: number, lat: number): [number, number] {
  const lambda = (lng * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const theta = Math.asin(M * Math.sin(phi))
  const t2 = theta * theta
  const t6 = t2 * t2 * t2
  const x =
    (lambda * Math.cos(theta)) /
    (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
  return [x * SCALE, -y * SCALE]
}

// The projection's extent at SCALE, for the viewBox.
const HALF_WIDTH = project(180, 0)[0]
const HALF_HEIGHT = -project(0, 90)[1]
// Antarctica is left off the flat map; it stays in the List.
const SOUTH_CUT = -60
const VIEW_BOX = `${-HALF_WIDTH} ${-HALF_HEIGHT} ${HALF_WIDTH * 2} ${
  HALF_HEIGHT - -project(0, SOUTH_CUT)[1]
}`

function ringPath(ring: number[][]): string {
  let path = ''
  let previousLng: number | null = null
  for (const [lng, lat] of ring) {
    const [x, y] = project(lng, Math.max(lat, SOUTH_CUT))
    // A jump across the antimeridian starts a new stroke, never a streak.
    const jump = previousLng !== null && Math.abs(lng - previousLng) > 180
    path += `${path === '' || jump ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    previousLng = lng
  }
  return `${path}Z`
}

function featurePath(feature: CountryFeature): string {
  const { type, coordinates } = feature.geometry
  const polygons =
    type === 'Polygon'
      ? [coordinates as number[][][]]
      : (coordinates as number[][][][])
  return polygons.map((polygon) => polygon.map(ringPath).join('')).join('')
}

interface MapShape {
  code: string
  countsCode: string | undefined
  name: string
  d: string
}

interface FlatMapProps {
  year: number
  selected: SelectedCountry | null
  highlight?: SelectedCountry | null
  onCountryClick: (country: SelectedCountry) => void
}

export function FlatMap({
  year,
  selected,
  highlight = null,
  onCountryClick,
}: FlatMapProps) {
  const [shapes, setShapes] = useState<MapShape[] | null>(null)
  const [counts, setCounts] = useState<CountryYearCounts | null>(null)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { features } = await loadCountryShapes()
        const built = features.flatMap((feature) => {
          const code = featureCode(feature)
          if (!code || feature.properties.ADMIN === 'Antarctica') return []
          return [
            {
              code,
              countsCode: isoOf(feature),
              name: feature.properties.ADMIN,
              d: featurePath(feature),
            },
          ]
        })
        if (cancelled) return
        setShapes(built)
        const { counts: loaded } = await loadSharedCounts(
          built.map((shape) => shape.code),
        )
        if (!cancelled) setCounts(loaded)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const yearMax = useMemo(
    () => (counts ? maxForRange(counts, year, year) : 0),
    [counts, year],
  )

  if (failed) {
    return (
      <p className={styles.note}>
        The map data would not load here — the search still finds any city,
        country or artist.
      </p>
    )
  }

  if (!shapes) {
    return <p className={styles.note}>Drawing the map…</p>
  }

  const countFor = (shape: MapShape) =>
    counts && shape.countsCode
      ? countInRange(counts[shape.countsCode], year, year)
      : 0
  const hovered = hover ? shapes.find((shape) => shape.code === hover.code) : null

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.map}
        viewBox={VIEW_BOX}
        role="img"
        aria-label={`World map of releases in ${year}. Use the List view or the search to pick a place by keyboard.`}
        onPointerLeave={() => setHover(null)}
      >
        {shapes.map((shape) => {
          const isSelected = selected?.code === shape.code
          const isHighlight = !selected && highlight?.code === shape.code
          const heat = bandedHeat(heatValue(countFor(shape), yearMax))
          return (
            <path
              key={shape.code}
              d={shape.d}
              className={`${styles.country} ${isHighlight ? styles.countryHighlight : ''}`}
              fill={
                isSelected
                  ? SELECTED_FILL
                  : heatColor(heat, hover?.code === shape.code)
              }
              onPointerMove={(event) => {
                const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                if (!box) return
                setHover({
                  code: shape.code,
                  x: event.clientX - box.left,
                  y: event.clientY - box.top,
                })
              }}
              onClick={() => onCountryClick({ code: shape.code, name: shape.name })}
            />
          )
        })}
      </svg>
      {hovered && hover && (
        <div
          className={styles.tooltip}
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          <span className={styles.tooltipName}>{hovered.name}</span>
          <span className={styles.tooltipCount}>
            {countFor(hovered).toLocaleString()} releases · {year}
          </span>
        </div>
      )}
    </div>
  )
}
