import Link from 'next/link'
import { TIER_LABELS, TIER_ORDER, type ArtistTier } from '@/lib/tiers'
import { ScrollRow } from '@/components/ui/ScrollRow'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './ArtistRows.module.css'

export interface ArtistCardData {
  slug: string
  name: string
  identity: string
  location: string
  /** Real hero photo if set, else first-video thumbnail — null shows a monogram plate. */
  thumbUrl: string | null
  tier?: ArtistTier
}

/** What each rotation group means — the site's own curation, for now. */
const TIER_NOTES: Record<ArtistTier, string> = {
  'heavy-rotation': 'Ear Clef’s all-time favourites.',
  'in-the-mix': 'Artists Ear Clef likes and returns to.',
  'on-the-radar': 'Artists Ear Clef is just getting to know.',
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

/**
 * The roster as rows that scroll sideways, one per rotation group, then
 * every artist A–Z so nobody is hard to find. The groups are the SITE'S
 * curation tiers today; when listeners can follow artists into their own
 * groups (Phase 2), the same rows will read from the listener's tiers.
 */
export function ArtistRows({ cards }: { cards: ArtistCardData[] }) {
  const byName = [...cards].sort((a, b) => a.name.localeCompare(b.name))
  const groups = TIER_ORDER.map((tier) => ({
    tier,
    cards: byName.filter((card) => card.tier === tier),
  })).filter((group) => group.cards.length > 0)

  return (
    <>
      {groups.map((group) => (
        <div key={group.tier} className={styles.rowWrap}>
          <ScrollRow
            id={`tier-${group.tier}`}
            title={TIER_LABELS[group.tier]}
            note={`${TIER_NOTES[group.tier]} ${group.cards.length} artist${group.cards.length === 1 ? '' : 's'}.`}
            perView={4}
            items={group.cards.map((card) => ({
              key: card.slug,
              node: <ArtistCard card={card} />,
            }))}
          />
        </div>
      ))}

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
    </>
  )
}
