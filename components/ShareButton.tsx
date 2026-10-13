'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import styles from './ShareButton.module.css'

interface ShareButtonProps {
  title: string
}

/**
 * Share this page: the device's own share sheet where there is one,
 * otherwise the link goes to the clipboard and the button says so.
 */
export function ShareButton({ title }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = window.location.href.split('#')[0]
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} — Ear Clef`, url })
        return
      } catch (error) {
        // A dismissed sheet is not a failure; anything else falls back.
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  return (
    <button type="button" className={styles.share} onClick={share}>
      <Icon name="share" size={16} />
      <span aria-live="polite">{copied ? 'Link copied' : 'Share'}</span>
    </button>
  )
}
