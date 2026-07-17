'use client'

import { useState } from 'react'
import type { ArtistServicePresence } from '@/lib/listen/services'
import { CatalogPopup } from '@/components/CatalogPopup'

interface CatalogLauncherProps {
  artistName: string
  mbid?: string
  fallbackUrl?: string
  hasBandcamp?: boolean
  presence?: ArtistServicePresence
  className: string
}

export function CatalogLauncher({
  artistName,
  mbid,
  fallbackUrl,
  hasBandcamp = false,
  presence,
  className,
}: CatalogLauncherProps) {
  const [open, setOpen] = useState(false)

  if (!mbid) {
    if (!fallbackUrl) return null
    return (
      <a className={className} href={fallbackUrl} target="_blank" rel="noreferrer">
        View full catalog →
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
          hasBandcamp={hasBandcamp}
          presence={presence}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
