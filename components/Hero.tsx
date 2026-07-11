import type { HeroContent } from '@/lib/types'
import { LinkPills } from '@/components/LinkPills'
import styles from './Hero.module.css'

interface HeroProps {
  hero: HeroContent
}

export function Hero({ hero }: HeroProps) {
  return (
    <header id="top" className={styles.hero}>
      <div className={`container ${styles.grid}`}>
        <div>
          <p className={styles.location}>{hero.location}</p>
          <h1 className={styles.name}>
            {hero.name}
            <span className={styles.period} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.identity}>{hero.identity}</p>
          {hero.tagline && <p className={styles.tagline}>{hero.tagline}</p>}
          <LinkPills links={hero.socials} ariaLabel="Social links" />
        </div>
        <div className={styles.imageFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero.image.src} alt={hero.image.alt} />
        </div>
      </div>
    </header>
  )
}
