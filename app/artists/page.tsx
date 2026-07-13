import type { Metadata } from 'next'
import { getAllArtists } from '@/lib/content'
import { youtubeThumbnailUrl } from '@/lib/links'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import {
  ArtistIndexGrid,
  type ArtistCardData,
} from '@/components/ArtistIndexGrid'
import styles from './artists.module.css'

export const metadata: Metadata = {
  title: 'Artists — Ear Clef',
  description:
    'Every artist universe on Ear Clef: music, videos, story, shows, and merch — one page each.',
}

export default function ArtistsPage() {
  const cards: ArtistCardData[] = getAllArtists().map((artist) => {
    const firstVideo = artist.watch.enabled
      ? artist.watch.videos[0]
      : undefined
    return {
      slug: artist.slug,
      name: artist.hero.name,
      identity: artist.hero.identity,
      location: artist.hero.location,
      thumbUrl: firstVideo ? youtubeThumbnailUrl(firstVideo.youtubeId) : null,
      tier: artist.tier,
    }
  })

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>The roster</p>
          <h1 className={styles.title}>Artists</h1>
          <p className={styles.subtitle}>
            One page per universe. {cards.length} and counting.
          </p>
          <ArtistIndexGrid cards={cards} />
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
