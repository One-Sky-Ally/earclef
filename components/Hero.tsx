import type { HeroContent } from '@/lib/types'
import { LinkPills } from '@/components/LinkPills'
import { HeroArt } from '@/components/HeroArt'
import { EarClefMark } from '@/components/EarClefMark'
import { ShareButton } from '@/components/ShareButton'
import { FirstFans } from '@/components/fans/FirstFans'
import { FollowButton } from '@/components/fans/FollowButton'
import { Icon } from '@/components/ui/Icon'
import styles from './Hero.module.css'

interface HeroProps {
  hero: HeroContent
  paletteVideoId?: string
  /** Artist slug — enables the fan Follow button on artist pages. */
  followSlug?: string
  /**
   * The page is written by Ear Clef from public sources, not run by the
   * artist — said plainly so nothing reads as the artist's endorsement.
   */
  editorial?: boolean
  /** Where the primary action goes: the videos, else the music. */
  primary?: { href: string; label: string }
}

export function Hero({
  hero,
  paletteVideoId,
  followSlug,
  editorial = false,
  primary,
}: HeroProps) {
  return (
    <header id="top" className={styles.hero}>
      <div className={`container ${styles.grid}`}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Artist</p>
          <h1 className={styles.name}>
            {hero.name}
            <span className={styles.period} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.location}>{hero.location}</p>
          <p className={styles.identity}>{hero.identity}</p>
          {hero.tagline && <p className={styles.tagline}>{hero.tagline}</p>}
          {editorial && (
            <p className={styles.editorial}>
              <EarClefMark size={20} />
              <span>
                Ear Clef editorial guide
                <span className={styles.editorialNote}>
                  {' '}
                  · written from public sources, not run by the artist
                </span>
              </span>
            </p>
          )}
          <div className={styles.actions}>
            {primary && (
              <a className={styles.primary} href={primary.href}>
                <Icon name="play" size={16} />
                {primary.label}
              </a>
            )}
            {followSlug && (
              <FollowButton slug={followSlug} artistName={hero.name} />
            )}
            <ShareButton title={hero.name} />
          </div>
          {hero.socials.length > 0 && (
            // Progressive disclosure (handoff): the links wait, closed.
            <details className={styles.links}>
              <summary className={styles.linksSummary}>
                Official links
                <span className={styles.linksCount}>{hero.socials.length}</span>
                <Icon name="chevronDown" size={16} className={styles.linksChevron} />
              </summary>
              <div className={styles.linksBody}>
                <LinkPills links={hero.socials} ariaLabel="Official links" />
              </div>
            </details>
          )}
          {followSlug && <FirstFans slug={followSlug} />}
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
