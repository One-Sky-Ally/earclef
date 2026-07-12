'use client'

import { useEffect, useState } from 'react'
import { extractPalette } from '@/lib/palette'
import { youtubeThumbnailUrl } from '@/lib/links'
import styles from './HeroArt.module.css'

const PLACEHOLDER = '/images/hero-placeholder.svg'
// The site's own gold, always present as the connective tissue.
const BRAND = '#f2a93b'

interface HeroArtProps {
  artistName: string
  imageSrc: string
  imageAlt: string
  /** First official video — its colors seed the artwork; no frame is shown. */
  paletteVideoId?: string
}

function hash01(input: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export function HeroArt({
  artistName,
  imageSrc,
  imageAlt,
  paletteVideoId,
}: HeroArtProps) {
  const [palette, setPalette] = useState<string[] | null>(null)

  const generative = imageSrc === PLACEHOLDER && Boolean(paletteVideoId)

  useEffect(() => {
    if (!generative || !paletteVideoId) return
    let cancelled = false
    extractPalette(youtubeThumbnailUrl(paletteVideoId)).then((colors) => {
      if (!cancelled && colors && colors.length >= 2) setPalette(colors)
    })
    return () => {
      cancelled = true
    }
  }, [generative, paletteVideoId])

  if (!generative || !palette) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={imageSrc} alt={imageAlt} />
  }

  const [c1, c2, c3 = c1, c4 = c2] = palette
  const ax = 120 + hash01(artistName, 1) * 360
  const ay = 100 + hash01(artistName, 2) * 200
  const bx = 180 + hash01(artistName, 3) * 300
  const by = 320 + hash01(artistName, 4) * 200
  const cx = 100 + hash01(artistName, 5) * 400
  const cy = 150 + hash01(artistName, 6) * 300
  const uid = `ha${Math.round(hash01(artistName, 7) * 1e6)}`

  return (
    <svg
      className={styles.art}
      viewBox="0 0 600 600"
      role="img"
      aria-label={`Abstract artwork generated from the colors of ${artistName}'s videos`}
    >
      <defs>
        <radialGradient id={`${uid}-a`}>
          <stop offset="0%" stopColor={c1} stopOpacity="0.85" />
          <stop offset="100%" stopColor={c1} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-b`}>
          <stop offset="0%" stopColor={c2} stopOpacity="0.75" />
          <stop offset="100%" stopColor={c2} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-c`}>
          <stop offset="0%" stopColor={c3} stopOpacity="0.5" />
          <stop offset="100%" stopColor={c3} stopOpacity="0" />
        </radialGradient>
        <filter id={`${uid}-blur`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="46" />
        </filter>
      </defs>

      <rect width="600" height="600" fill="#171210" />
      <g filter={`url(#${uid}-blur)`}>
        <circle cx={ax} cy={ay} r="230" fill={`url(#${uid}-a)`} />
        <circle cx={bx} cy={by} r="260" fill={`url(#${uid}-b)`} />
        <circle cx={cx} cy={cy} r="180" fill={`url(#${uid}-c)`} />
      </g>

      <g fill="none" strokeWidth="1.4">
        {[70, 115, 160, 205, 250].map((radius, index) => (
          <circle
            key={radius}
            cx="300"
            cy="300"
            r={radius}
            stroke={index % 2 === 0 ? BRAND : c4}
            strokeOpacity={index % 2 === 0 ? 0.22 : 0.3}
          />
        ))}
      </g>

      <circle cx="300" cy="300" r="24" fill={BRAND} fillOpacity="0.85" />
      <circle cx="300" cy="300" r="7" fill="#171210" />
    </svg>
  )
}
