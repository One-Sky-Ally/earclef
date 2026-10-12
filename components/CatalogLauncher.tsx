'use client'

import { useState } from 'react'
import { CatalogPopup } from '@/components/CatalogPopup'

interface CatalogLauncherProps {
  artistName: string
  mbid?: string
  /** Artist page on a platform, when MusicBrainz has no catalog for them. */
  fallbackUrl?: string
  /** The platform the fallback opens — named on the link, never implied. */
  fallbackLabel?: string
  className: string
}

export function CatalogLauncher({
  artistName,
  mbid,
  fallbackUrl,
  fallbackLabel,
  className,
}: CatalogLauncherProps) {
  const [open, setOpen] = useState(false)

  if (!mbid) {
    if (!fallbackUrl) return null
    return (
      <a className={className} href={fallbackUrl} target="_blank" rel="noreferrer">
        View full catalog{fallbackLabel ? ` on ${fallbackLabel}` : ''} ↗
      </a>
    )
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        View full catalog →
      </button>
      {open && (
        <CatalogPopup
          mbid={mbid}
          artistName={artistName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
