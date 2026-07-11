import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllArtists } from '@/lib/content'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './artists.module.css'

export const metadata: Metadata = {
  title: 'Artists — Ear Clef',
  description:
    'Every artist universe on Ear Clef: music, videos, story, shows, and merch — one page each.',
}

export default function ArtistsPage() {
  const artists = getAllArtists()

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>The roster</p>
          <h1 className={styles.title}>Artists</h1>
          <p className={styles.subtitle}>
            One page per universe. {artists.length} and counting.
          </p>
          <ul className={styles.grid}>
            {artists.map((artist, index) => (
              <li key={artist.slug}>
                <Link className={styles.card} href={`/${artist.slug}`}>
                  <span className={styles.index} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.name}>{artist.hero.name}</span>
                  <span className={styles.identity}>
                    {artist.hero.identity}
                  </span>
                  <span className={styles.location}>
                    {artist.hero.location}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
