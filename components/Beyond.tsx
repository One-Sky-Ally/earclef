import type { BeyondContent, BeyondKind } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import styles from './Beyond.module.css'

interface BeyondProps {
  beyond: BeyondContent
}

const KIND_LABELS: Record<BeyondKind, string> = {
  'film-role': 'Film',
  'film-score': 'Film score',
  'screen-sync': 'On screen',
  book: 'Book',
  art: 'Art',
  other: 'Beyond',
}

/**
 * Notable creative work outside the music — screen roles, books, art.
 * Verified only (IMDb for roles, publishers for books); the section
 * hides entirely for artists with nothing notable. Links out to
 * preview/buy pages, same model as merch.
 */
export function Beyond({ beyond }: BeyondProps) {
  return (
    <section
      id="beyond"
      className="section"
      aria-labelledby="beyond-heading"
    >
      <div className="container">
        <SectionHeader
          number="07"
          title="Beyond the Music"
          headingId="beyond-heading"
        />
        <ul className={styles.list}>
          {beyond.items.map((item) => (
            <li key={item.title}>
              <a
                className={styles.item}
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className={styles.kind}>{KIND_LABELS[item.kind]}</span>
                <span className={styles.text}>
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.context}>{item.context}</span>
                </span>
                <span className={styles.arrow} aria-hidden="true">
                  {item.linkLabel ?? '↗'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
