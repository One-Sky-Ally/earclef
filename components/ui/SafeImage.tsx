'use client'

import { useEffect, useRef, useState } from 'react'

interface SafeImageProps {
  src: string
  className?: string
  alt?: string
}

/**
 * A decorative remote image that disappears cleanly when it can't load
 * — including when it failed before hydration, when React's onError
 * never fires — so the surface beneath (a quiet plate) shows instead
 * of a broken-image glyph.
 */
export function SafeImage({ src, className, alt = '' }: SafeImageProps) {
  const ref = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [src])

  if (failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
