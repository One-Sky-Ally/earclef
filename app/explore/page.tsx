import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import { ExploreClient } from '@/components/explore/ExploreClient'
import styles from './explore.module.css'

export const metadata: Metadata = {
  title: 'Explore — Ear Clef',
  description:
    'A music time-travel globe: pick a year, spin the earth, and see where the music came from.',
}

export default function ExplorePage() {
  return (
    <>
      <SiteNav />
      <main className={styles.main}>
        <div className={`container ${styles.header}`}>
          <p className={styles.overline}>Music time travel</p>
          <h1 className={styles.title}>Explore</h1>
          <p className={styles.subtitle}>
            Spin the earth. Pick a year. Hear the world.
          </p>
        </div>
        <ExploreClient />
        <p className={styles.hint}>
          Drag to spin · scroll to zoom · slide through time — country details
          coming next
        </p>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
