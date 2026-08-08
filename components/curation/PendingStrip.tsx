'use client'

import { useEffect, useState } from 'react'
import { safeStoredHref } from '@/lib/play/storedHref'
import styles from './PendingStrip.module.css'

interface PendingEntry {
  name: string
  mbid: string
  listenHref?: string
}

export function PendingStrip() {
  const [entries, setEntries] = useState<PendingEntry[]>([])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/follow', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((body: { entries: PendingEntry[] }) => setEntries(body.entries))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  if (entries.length === 0) return null

  return (
    <aside className={styles.strip} aria-label="Pages pending">
      <span className={styles.label}>Following — pages pending</span>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.mbid}>
            {/* Navigation pill, not a play button — stored hrefs from
                before the verified-play policy may be search URLs, so
                they pass through the guard and lose the ▶ glyph. */}
            <a
              className={styles.pill}
              href={safeStoredHref(entry.listenHref, entry.mbid)}
              target="_blank"
              rel="noreferrer"
            >
              {entry.name}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}
