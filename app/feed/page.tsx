import type { Metadata } from 'next'
import { getAllArtists } from '@/lib/content'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import { FeedClient, type RosterEntry } from '@/components/feed/FeedClient'
import styles from './feed.module.css'

export const metadata: Metadata = {
  title: 'Latest — Ear Clef',
  description:
    'The music-only feed: new releases and videos from every artist on the Ear Clef roster, newest first.',
}

export default function FeedPage() {
  const roster: RosterEntry[] = getAllArtists().map((artist) => ({
    slug: artist.slug,
    name: artist.hero.name,
    mbid: artist.integrations.setlistfm.mbid || undefined,
    channelId: artist.integrations.youtube.channelId || undefined,
    itunesId: artist.integrations.itunes?.artistId || undefined,
    tier: artist.tier,
  }))

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>The music-only feed</p>
          <h1 className={styles.title}>Latest</h1>
          <p className={styles.subtitle}>
            New releases and videos from the whole roster, newest first.
          </p>
          <FeedClient roster={roster} />
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
