import type { Metadata } from 'next'
import { getAllArtists } from '@/lib/content'
import { SiteNav } from '@/components/SiteNav'
import { TasteMap } from '@/components/fans/TasteMap'
import {
  LikedSongs,
  type RosterByMbid,
} from '@/components/fans/LikedSongs'
import styles from './me.module.css'

export const metadata: Metadata = {
  title: 'My taste map — Ear Clef',
  description:
    'Your personal Ear Clef: the artists you follow, your own rotation tiers, and your permanent first-fan numbers.',
  robots: { index: false },
}

export default function MePage() {
  const artists = getAllArtists()
  const roster = artists.map((artist) => ({
    slug: artist.slug,
    name: artist.hero.name,
  }))
  // Saved songs carry a MusicBrainz id, not a slug — most are artists
  // the site has no page for, and the few that do get linked.
  const rosterByMbid: RosterByMbid = Object.fromEntries(
    artists.flatMap((artist) => {
      const mbid = artist.integrations.setlistfm.mbid
      return mbid
        ? [[mbid, { slug: artist.slug, name: artist.hero.name }] as const]
        : []
    }),
  )

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
          <TasteMap roster={roster} rosterByMbid={rosterByMbid} />
          <LikedSongs roster={rosterByMbid} />
        </div>
      </main>
    </>
  )
}
