'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Icon } from '@/components/ui/Icon'
import styles from './FlatMap.module.css'

/**
 * The flat Map view — the same countries, heat and selection as the
 * globe, drawn as an SVG in the Equal Earth projection. It needs no
 * WebGL, so it is the first alternative when the 3D globe can't run.
 * Inline it is a still picture with an Expand button; expanded (full
 * screen) it zooms and pans by wheel, pinch, drag or the +/− buttons,
 * so small countries are reachable. The List view and the search stay
 * the keyboard ways in.
 */

const SELECTED_FILL = 'rgba(228, 114, 106, 0.88)'
const SELECTED_STROKE = 'rgba(255, 176, 166, 0.98)'
// Borders, drawn at a constant screen width whatever the zoom: a gold
// line around cool countries, a dark seam between hot ones (the
// globe's own rule, so neighbours never melt into one gold mass).
const STROKE = 'rgba(242, 169, 59, 0.55)'
const HOT_STROKE = 'rgba(20, 14, 9, 0.95)'
const HOT_STROKE_THRESHOLD = 3 / 7

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

// Antarctica is left off the flat map; it stays in the List.
const SOUTH_CUT = -60
const HALF_WIDTH = project(180, 0)[0]
const TOP = project(0, 90)[1]
const BOTTOM = project(0, SOUTH_CUT)[1]

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

const BASE: ViewBox = { x: -HALF_WIDTH, y: TOP, w: HALF_WIDTH * 2, h: BOTTOM - TOP }
/** Deepest zoom: a sixteenth of the world's width. */
const MIN_WIDTH = BASE.w / 16

/** The map's outline — the same shape as the globe, flattened. */
const OUTLINE = (() => {
  const points: string[] = []
  for (let lat = SOUTH_CUT; lat <= 90; lat += 2) {
    const [x, y] = project(-180, lat)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  for (let lat = 90; lat >= SOUTH_CUT; lat -= 2) {
    const [x, y] = project(180, lat)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return `M${points.join('L')}Z`
})()

function ringPath(ring: number[][]): string {
  let path = ''
  let previousLng: number | null = null
  for (const [lng, lat] of ring) {
    const [x, y] = project(lng, Math.max(lat, SOUTH_CUT))
    // A jump across the antimeridian starts a new stroke, never a streak.
    const jump = previousLng !== null && Math.abs(lng - previousLng) > 180
    path += `${path === '' || jump ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
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

/** Keep a zoomed view inside the world. */
function clampView(view: ViewBox): ViewBox {
  const w = Math.min(BASE.w, Math.max(MIN_WIDTH, view.w))
  const h = (w / BASE.w) * BASE.h
  const x = Math.min(BASE.x + BASE.w - w, Math.max(BASE.x, view.x))
  const y = Math.min(BASE.y + BASE.h - h, Math.max(BASE.y, view.y))
  return { x, y, w, h }
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
  /** Full screen: zoom and pan on. */
  interactive?: boolean
  /** Inline: show an Expand button that opens the full-screen map. */
  onExpand?: () => void
}

export function FlatMap({
  year,
  selected,
  highlight = null,
  onCountryClick,
  interactive = false,
  onExpand,
}: FlatMapProps) {
  const [shapes, setShapes] = useState<MapShape[] | null>(null)
  const [counts, setCounts] = useState<CountryYearCounts | null>(null)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null)
  const [view, setView] = useState<ViewBox>(BASE)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // A drag that moved the map must not also click the country under it.
  const draggedRef = useRef(false)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())

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

  /** Zoom by `factor` (<1 = closer) about a screen point. */
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    setView((current) => {
      // preserveAspectRatio "meet": one scale, content centred.
      const scale = Math.max(current.w / rect.width, current.h / rect.height)
      const offsetX = (rect.width - current.w / scale) / 2
      const offsetY = (rect.height - current.h / scale) / 2
      const px = current.x + (clientX - rect.left - offsetX) * scale
      const py = current.y + (clientY - rect.top - offsetY) * scale
      const w = Math.min(BASE.w, Math.max(MIN_WIDTH, current.w * factor))
      const ratio = w / current.w
      return clampView({
        x: px - (px - current.x) * ratio,
        y: py - (py - current.y) * ratio,
        w,
        h: current.h * ratio,
      })
    })
  }, [])

  const zoomCentre = useCallback(
    (factor: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
    },
    [zoomAt],
  )

  // Wheel zoom (full screen only — inline, the wheel scrolls the page).
  useEffect(() => {
    const svg = svgRef.current
    if (!interactive || !svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * 0.0018))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [interactive, zoomAt, shapes])

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    draggedRef.current = false
    let travelled = 0
    const onMove = (move: PointerEvent) => {
      const pointers = pointersRef.current
      const previous = pointers.get(move.pointerId)
      if (!previous) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      if (pointers.size === 2) {
        // Pinch: zoom about the midpoint by the change in finger spread.
        const [a, b] = [...pointers.values()]
        const before = Math.hypot(a.x - b.x, a.y - b.y)
        pointers.set(move.pointerId, { x: move.clientX, y: move.clientY })
        const [c, d] = [...pointers.values()]
        const after = Math.hypot(c.x - d.x, c.y - d.y)
        if (before > 0 && after > 0) {
          zoomAt((c.x + d.x) / 2, (c.y + d.y) / 2, before / after)
        }
        draggedRef.current = true
        return
      }
      const dx = move.clientX - previous.x
      const dy = move.clientY - previous.y
      pointers.set(move.pointerId, { x: move.clientX, y: move.clientY })
      travelled += Math.hypot(dx, dy)
      if (travelled < 4) return
      draggedRef.current = true
      setView((current) => {
        const scale = Math.max(current.w / rect.width, current.h / rect.height)
        return clampView({ ...current, x: current.x - dx * scale, y: current.y - dy * scale })
      })
    }
    const onUp = (up: PointerEvent) => {
      pointersRef.current.delete(up.pointerId)
      if (pointersRef.current.size > 0) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      // The click (if any) lands after pointerup; let it see the flag first.
      setTimeout(() => {
        draggedRef.current = false
      }, 0)
    }
    if (pointersRef.current.size === 1) {
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }
  }

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
  const zoomed = view.w < BASE.w - 0.5

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${interactive ? styles.wrapInteractive : ''}`}
    >
      <svg
        ref={svgRef}
        className={styles.map}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label={`World map of releases in ${year}. Use the List view or the search to pick a place by keyboard.`}
        onPointerDown={onPointerDown}
        onPointerLeave={() => setHover(null)}
      >
        <path className={styles.outline} d={OUTLINE} />
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
              stroke={
                isSelected
                  ? SELECTED_STROKE
                  : heat >= HOT_STROKE_THRESHOLD
                    ? HOT_STROKE
                    : STROKE
              }
              onPointerMove={(event) => {
                const box = wrapRef.current?.getBoundingClientRect()
                if (!box || event.pointerType === 'touch') return
                setHover({
                  code: shape.code,
                  x: event.clientX - box.left,
                  y: event.clientY - box.top,
                })
              }}
              onClick={() => {
                if (draggedRef.current) return
                onCountryClick({ code: shape.code, name: shape.name })
              }}
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
      {onExpand && (
        <button type="button" className={styles.expand} onClick={onExpand}>
          <Icon name="expand" size={18} />
          Expand map
        </button>
      )}
      {interactive && (
        <div className={styles.zoom} role="group" aria-label="Zoom the map">
          <button type="button" onClick={() => zoomCentre(0.6)} aria-label="Zoom in">
            <Icon name="plus" size={18} />
          </button>
          <button
            type="button"
            onClick={() => zoomCentre(1 / 0.6)}
            aria-label="Zoom out"
            disabled={!zoomed}
          >
            <Icon name="minus" size={18} />
          </button>
          <button
            type="button"
            className={styles.zoomReset}
            onClick={() => setView(BASE)}
            disabled={!zoomed}
          >
            Whole world
          </button>
        </div>
      )}
    </div>
  )
}
