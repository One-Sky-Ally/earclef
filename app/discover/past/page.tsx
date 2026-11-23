import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooterSimple } from '@/components/SiteFooterSimple'
import { PastPicks } from '@/components/discover/PastPicks'
import styles from './past.module.css'

export const metadata: Metadata = {
  title: 'Past Discover picks — Ear Clef',
  description:
    'Every artist Discover has recommended so far, with what you have and haven’t played yet.',
  robots: { index: false },
}

export default function PastPicksPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>
            <Link href="/artists#discover-heading">Discover new artists</Link>
          </p>
          <h1 className={styles.title}>All past picks</h1>
          <p className={styles.subtitle}>
            Every artist Discover has recommended, newest first. Press play on one and
            it&rsquo;s marked as played. That list stays in this browser only &mdash;{' '}
            <Link href="/privacy">see Privacy</Link>.
          </p>
          <PastPicks />
        </div>
      </main>
      <SiteFooterSimple />
    </>
  )
}
