import Link from 'next/link'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './ArtistRows.module.css'

export interface ArtistCardData {
  slug: string
  name: string
  identity: string
  location: string
  /** Real hero photo if set, else first-video thumbnail — null shows a monogram plate. */
  thumbUrl: string | null
}

function monogram(name: string): string {
  const words = name.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((word) => [...word][0] ?? '').join('').toUpperCase() || '♪'
}

export function ArtistCard({ card }: { card: ArtistCardData }) {
  return (
    <Link className={styles.card} href={`/${card.slug}`}>
      <span className={styles.art} aria-hidden="true">
        <span className={styles.monogram}>{monogram(card.name)}</span>
        {card.thumbUrl && <SafeImage className={styles.image} src={card.thumbUrl} />}
      </span>
      <span className={styles.body}>
        <span className={styles.name}>{card.name}</span>
        <span className={styles.identity}>{card.identity}</span>
        <span className={styles.location}>{card.location}</span>
      </span>
    </Link>
  )
}

/** Every artist A–Z, rendered on the server so nobody is hard to find. */
export function ArtistAZ({ cards }: { cards: ArtistCardData[] }) {
  const byName = [...cards].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <section className={styles.az} aria-labelledby="all-artists-heading">
      <h2 id="all-artists-heading" className={styles.azHeading}>
        Every artist, A–Z
      </h2>
      <ul className={styles.azList}>
        {byName.map((card) => (
          <li key={card.slug}>
            <Link className={styles.azLink} href={`/${card.slug}`}>
              <span className={styles.azName}>{card.name}</span>
              <span className={styles.azPlace}>{card.location}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
