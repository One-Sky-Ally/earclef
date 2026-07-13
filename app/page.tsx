import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import { ExploreClient } from '@/components/explore/ExploreClient'
import styles from './explore.module.css'

export const metadata: Metadata = {
  title: 'Ear Clef — Hear here!',
  description:
    'A music time-travel globe: pick a year, spin the earth, and see where the music came from. One page per artist universe.',
}

export default function HomePage() {
  return (
    <>
      <SiteNav showSections={false} />
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
          Drag to spin · scroll to zoom · slide through time · click a country
          or search a place for its artists &amp; releases
        </p>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
