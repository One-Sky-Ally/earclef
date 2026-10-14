import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllArtists } from '@/lib/content'
import { youtubeThumbnailUrl } from '@/lib/links'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooterSimple } from '@/components/SiteFooterSimple'
import { ArtistRows, type ArtistCardData } from '@/components/ArtistRows'
import { DiscoverSection } from '@/components/discover/DiscoverSection'
import { PendingStrip } from '@/components/curation/PendingStrip'
import styles from './artists.module.css'

export const metadata: Metadata = {
  title: 'Artists — Ear Clef',
  description:
    'Every artist universe on Ear Clef: music, videos, story, shows, and merch — one page each.',
}

export default function ArtistsPage() {
  const cards: ArtistCardData[] = getAllArtists().map((artist) => {
    const heroImage = artist.hero.image.src
    const hasRealHeroImage = heroImage !== '/images/hero-placeholder.svg'
    const firstVideo = artist.watch.enabled
      ? artist.watch.videos[0]
      : undefined
    const thumbUrl = hasRealHeroImage
      ? heroImage
      : firstVideo
        ? youtubeThumbnailUrl(firstVideo.youtubeId)
        : null
    return {
      slug: artist.slug,
      name: artist.hero.name,
      identity: artist.hero.identity,
      location: artist.hero.location,
      thumbUrl,
      tier: artist.tier,
    }
  })

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <h1 className={styles.title}>Artists</h1>
          <p className={styles.subtitle}>
            One page per artist universe — {cards.length} and counting.
          </p>
          <DiscoverSection />
          <PendingStrip />
          <ArtistRows cards={cards} />
          <p className={styles.suggest}>
            Know someone who belongs here?{' '}
            <Link className={styles.suggestLink} href="/suggest">
              Suggest an artist →
            </Link>
          </p>
        </div>
      </main>
      <SiteFooterSimple />
    </>
  )
}
