import type { HeroContent } from '@/lib/types'
import { LinkPills } from '@/components/LinkPills'
import { HeroArt } from '@/components/HeroArt'
import styles from './Hero.module.css'

interface HeroProps {
  hero: HeroContent
  paletteVideoId?: string
}

export function Hero({ hero, paletteVideoId }: HeroProps) {
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
          <HeroArt
            artistName={hero.name}
            imageSrc={hero.image.src}
            imageAlt={hero.image.alt}
            paletteVideoId={paletteVideoId}
          />
        </div>
      </div>
    </header>
  )
}
