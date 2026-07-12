'use client'

import { useState } from 'react'
import { VideosPopup } from '@/components/VideosPopup'

interface VideosLauncherProps {
  artistName: string
  channelId?: string
  fallbackUrl?: string
  className: string
}

export function VideosLauncher({
  artistName,
  channelId,
  fallbackUrl,
  className,
}: VideosLauncherProps) {
  const [open, setOpen] = useState(false)

  if (!channelId) {
    if (!fallbackUrl) return null
    return (
      <a className={className} href={fallbackUrl} target="_blank" rel="noreferrer">
        View all videos →
      </a>
    )
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        View all videos →
      </button>
      {open && (
        <VideosPopup
          channelId={channelId}
          artistName={artistName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
