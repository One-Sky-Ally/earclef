'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'
import styles from './OnThisDayLink.module.css'

/**
 * The small way in to "On this day" (owner, Oct 10 2026: "a small entry
 * point somewhere on the site that people discover"). It names the
 * visitor's own today once their clock is known; before that it reads
 * just "On this day", so server and client render the same first.
 */
const subscribeToNothing = () => () => {}
const todayLabel = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

export function OnThisDayLink() {
  // Null on the server, the visitor's own date on their device.
  const today = useSyncExternalStore(subscribeToNothing, todayLabel, () => null)
  return (
    <Link href="/on-this-day" className={styles.link}>
      <span aria-hidden="true" className={styles.mark}>♪</span>
      On this day{today ? ` · ${today}` : ''}
      <span aria-hidden="true">→</span>
    </Link>
  )
}
