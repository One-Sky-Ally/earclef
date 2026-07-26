import type { Metadata } from 'next'
import { getAllArtists } from '@/lib/content'
import { SiteNav } from '@/components/SiteNav'
import { TasteMap } from '@/components/fans/TasteMap'
import styles from './me.module.css'

export const metadata: Metadata = {
  title: 'My taste map — Ear Clef',
  description:
    'Your personal Ear Clef: the artists you follow, your own rotation tiers, and your permanent first-fan numbers.',
  robots: { index: false },
}

export default function MePage() {
  const roster = getAllArtists().map((artist) => ({
    slug: artist.slug,
    name: artist.hero.name,
  }))

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>Your personal Ear Clef</p>
          <h1 className={styles.title}>My taste map</h1>
          <p className={styles.subtitle}>
            The artists you follow, in your own rotation — and the fan
            numbers that prove you were early.
          </p>
          <TasteMap roster={roster} />
        </div>
      </main>
    </>
  )
}
