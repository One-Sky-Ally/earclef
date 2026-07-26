'use client'

import { useEffect, useState } from 'react'
import styles from './FirstFans.module.css'

interface FirstFanStamp {
  number: number
  since: string
}

/** "2026-07-16" → "Jul 2026". */
function sinceLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/**
 * The artist's earliest supporters — anonymous by design (numbers and
 * dates only, never names). A quiet celebration of being early; hides
 * entirely until someone has followed.
 */
export function FirstFans({ slug }: { slug: string }) {
  const [fans, setFans] = useState<FirstFanStamp[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/artist/first-fans/${slug}`)
        if (!res.ok) return
        const body = (await res.json()) as { fans?: FirstFanStamp[] }
        if (!cancelled && body.fans) setFans(body.fans)
      } catch {
        // No strip is the safe default.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  if (fans.length === 0) return null

  return (
    <p className={styles.strip} aria-label="First fans">
      <span className={styles.label}>First fans</span>
      {fans.map((fan) => (
        <span key={fan.number} className={styles.stamp}>
          <span className={styles.number}>#{fan.number}</span>
          <span className={styles.since}> {sinceLabel(fan.since)}</span>
        </span>
      ))}
    </p>
  )
}
