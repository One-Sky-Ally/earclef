import type { Metadata } from 'next'
import { getAllArtists } from '@/lib/content'
import { presenceFromContent } from '@/lib/listen/services'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooterSimple } from '@/components/SiteFooterSimple'
import { FeedClient, type RosterEntry } from '@/components/feed/FeedClient'
import styles from './feed.module.css'

export const metadata: Metadata = {
  title: 'Feed — Ear Clef',
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
    presence: presenceFromContent(artist),
  }))

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className={styles.column}>
          <h1 className={styles.title}>Feed</h1>
          <p className={styles.subtitle}>
            New releases and videos from the whole roster, newest first.
            Descriptions are original Ear Clef summaries written from public
            release metadata; artwork links to the source.
          </p>
          <FeedClient roster={roster} />
        </div>
      </main>
      <SiteFooterSimple />
    </>
  )
}
