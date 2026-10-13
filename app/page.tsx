import type { Metadata } from 'next'
import { getAllArtists } from '@/lib/content'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooterSimple } from '@/components/SiteFooterSimple'
import { ExploreClient } from '@/components/explore/ExploreClient'
import type { RosterByMbid } from '@/components/explore/CountryPanel'
import { ERA_JOURNEYS, SONG_PLACES } from '@/lib/explore/cultures'
import playing from '@/lib/explore/playing.json'
import type { PlayingEntry } from '@/lib/explore/playing'
import styles from './explore.module.css'

export const metadata: Metadata = {
  title: 'Ear Clef — Hear here!',
  description:
    'Where will music take you? Pick a place, choose an era and find your next favorite — a music time-travel globe with one page per artist universe.',
}

export default function HomePage() {
  const roster: RosterByMbid = Object.fromEntries(
    getAllArtists().flatMap((artist) => {
      const mbid = artist.integrations.setlistfm.mbid
      return mbid
        ? [[mbid, { slug: artist.slug, name: artist.hero.name }] as const]
        : []
    }),
  )

  return (
    <>
      <SiteNav showSections={false} wide />
      <main className={styles.main}>
        <ExploreClient
          roster={roster}
          // The surprise picker needs only three numbers per documented
          // era; the curated journeys below carry their own stories.
          surpriseEras={(playing as { entries: PlayingEntry[] }).entries.map(
            (entry) => ({
              country: entry.country,
              from: entry.from,
              to: entry.to,
            }),
          )}
          eras={ERA_JOURNEYS}
          songPlaces={SONG_PLACES}
        />
      </main>
      <SiteFooterSimple />
    </>
  )
}
