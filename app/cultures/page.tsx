import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooterSimple } from '@/components/SiteFooterSimple'
import { CultureCard } from '@/components/explore/CultureCard'
import { JOURNEY_SUMMARIES, SONG_PLACES } from '@/lib/explore/cultures'
import styles from './cultures.module.css'

export const metadata: Metadata = {
  title: 'Music cultures — Ear Clef',
  description:
    'Ear Clef picks: documented eras of music around the world, places by the decade, and the songs written about places — every song plays on Ear Clef.',
}

/**
 * "See all" from the Explore page's Music cultures row: every culture
 * the row draws from, labelled as Ear Clef picks. Each card opens its
 * journey on Explore (/?j=…), where it plays.
 */
export default function CulturesPage() {
  const eras = JOURNEY_SUMMARIES.filter((journey) => journey.kind === 'era').sort(
    (a, b) => a.from - b.from || a.to - b.to,
  )
  const decades = JOURNEY_SUMMARIES.filter((journey) => journey.kind === 'decade').sort(
    (a, b) => a.place.localeCompare(b.place) || a.from - b.from,
  )
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
            Places, eras and sounds worth a journey — and every song in them
            plays here. Documented eras are snapshots anchored to a national
            chart where one existed, to scene history where none did, with
            their sources listed. Decade journeys gather songs released in a
            place in that decade, each one verified as that release. The song
            collections are songs written about each place.
          </p>
        </header>

        <section className={styles.group} aria-labelledby="eras-heading">
          <div className={styles.groupHead}>
            <h2 id="eras-heading" className={styles.groupTitle}>
              Documented eras
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

        <section className={styles.group} aria-labelledby="decades-heading">
          <div className={styles.groupHead}>
            <h2 id="decades-heading" className={styles.groupTitle}>
              Places by the decade
            </h2>
            <p className={styles.groupNote}>
              {decades.length} journeys across{' '}
              {new Set(decades.map((decade) => decade.code)).size} countries
            </p>
          </div>
          <ul className={styles.grid}>
            {decades.map((decade) => (
              <li key={decade.id}>
                <CultureCard culture={decade} href={`/?j=${decade.id}`} />
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
