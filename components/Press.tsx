import type { PressContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import styles from './Press.module.css'

interface PressProps {
  press: PressContent
}

export function Press({ press }: PressProps) {
  return (
    <section id="press" className="section" aria-labelledby="press-heading">
      <div className="container">
        <SectionHeader
          number="06"
          title="Press &amp; Links"
          headingId="press-heading"
        />
        <ul className={styles.list}>
          {press.items.map((item, i) => (
            <li key={item.url}>
              <a
                className={styles.item}
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className={styles.index} aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.outlet}>{item.outlet}</span>
                </span>
                <span className={styles.arrow} aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
