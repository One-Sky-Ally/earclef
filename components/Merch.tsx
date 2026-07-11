import type { MerchContent } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'
import styles from './Merch.module.css'

interface MerchProps {
  merch: MerchContent
}

export function Merch({ merch }: MerchProps) {
  return (
    <section id="merch" className="section" aria-labelledby="merch-heading">
      <div className="container">
        <SectionHeader number="05" title="Merch" headingId="merch-heading" />
        <ul className={styles.grid}>
          {merch.items.map((item) => (
            <li key={item.url}>
              <a
                className={styles.card}
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className={styles.imageWrap}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={styles.image}
                    src={item.image.src}
                    alt={item.image.alt}
                    loading="lazy"
                  />
                </span>
                <span className={styles.body}>
                  <span className={styles.name}>{item.name}</span>
                  {item.description && (
                    <span className={styles.description}>
                      {item.description}
                    </span>
                  )}
                  <span className={styles.cta}>
                    {item.price ? `${item.price} · ` : ''}Visit store ↗
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
