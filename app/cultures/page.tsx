import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooterSimple } from '@/components/SiteFooterSimple'
import { CultureCard } from '@/components/explore/CultureCard'
import { ERA_JOURNEYS, SONG_PLACES } from '@/lib/explore/cultures'
import styles from './cultures.module.css'

export const metadata: Metadata = {
  title: 'Music cultures — Ear Clef',
  description:
    'Ear Clef picks: documented eras of music around the world, and the songs written about places — each one opens on the Explore globe.',
}

/**
 * "See all" from the Explore page's Music cultures row: every culture
 * the row draws from, labelled as Ear Clef picks. Each card opens its
 * journey on Explore (/?j=…), where it plays.
 */
export default function CulturesPage() {
  const eras = [...ERA_JOURNEYS].sort((a, b) => a.from - b.from || a.to - b.to)
  const countries = SONG_PLACES.filter((place) => place.placeKind === 'country')
  const regions = SONG_PLACES.filter((place) => place.placeKind !== 'country')

  return (
    <>
      <SiteNav showSections={false} wide />
      <main className={styles.main}>
        <header className={styles.header}>
          <p className={styles.overline}>Ear Clef picks</p>
          <h1 className={styles.title}>Music cultures</h1>
          <p className={styles.intro}>
            Places, eras and sounds worth a journey. Every era here is a
            documented snapshot — anchored to a national chart where one
            existed, to scene history where none did — with its sources
            listed. The song collections are songs written about each place,
            and only the ones that play on the site.
          </p>
        </header>

        <section className={styles.group} aria-labelledby="eras-heading">
          <div className={styles.groupHead}>
            <h2 id="eras-heading" className={styles.groupTitle}>
              Era journeys
            </h2>
            <p className={styles.groupNote}>
              {eras.length} documented eras, oldest first
            </p>
          </div>
          <ul className={styles.grid}>
            {eras.map((era) => (
              <li key={era.id}>
                <CultureCard culture={era} href={`/?j=${era.id}`} />
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.group} aria-labelledby="songs-heading">
          <div className={styles.groupHead}>
            <h2 id="songs-heading" className={styles.groupTitle}>
              Songs about a place
            </h2>
            <p className={styles.groupNote}>
              {countries.length} countries, most songs first
            </p>
          </div>
          <ul className={styles.grid}>
            {countries.map((place) => (
              <li key={place.id}>
                <CultureCard culture={place} href={`/?j=${place.id}`} />
              </li>
            ))}
          </ul>
        </section>

        {regions.length > 0 && (
          <section className={styles.group} aria-labelledby="regions-heading">
            <div className={styles.groupHead}>
              <h2 id="regions-heading" className={styles.groupTitle}>
                States and nations
              </h2>
              <p className={styles.groupNote}>
                {regions.length} US states and UK nations
              </p>
            </div>
            <ul className={styles.grid}>
              {regions.map((place) => (
                <li key={place.id}>
                  <CultureCard culture={place} href={`/?j=${place.id}`} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooterSimple />
    </>
  )
}
