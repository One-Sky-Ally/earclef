import Link from 'next/link'
import { EarClefMark } from '@/components/EarClefMark'
import { SiteNavLinks } from '@/components/SiteNavLinks'
import styles from './SiteNav.module.css'

/**
 * An artist page's sections, in the handoff's anchor vocabulary:
 * Overview, Music, Videos, Live, Story, Merch. Each maps to the
 * section id the page already renders.
 */
const SECTIONS = [
  { id: 'top', label: 'Overview' },
  { id: 'listen', label: 'Music' },
  { id: 'watch', label: 'Videos' },
  { id: 'shows', label: 'Live' },
  { id: 'story', label: 'Story' },
  { id: 'merch', label: 'Merch' },
  { id: 'press', label: 'Press' },
]

interface SiteNavProps {
  /** Path the section anchors belong to, e.g. "/" or "/bjork". */
  anchorBase?: string
  /** Hide section anchors on non-artist pages. */
  showSections?: boolean
  /** The artist the section bar belongs to. */
  artistName?: string
  /** Artists with native audio get a Play anchor ahead of the rest. */
  includePlay?: boolean
  /** Artists with verified non-music work get a Beyond anchor. */
  includeBeyond?: boolean
  /** Artists with a membership get their perk anchor after the rest. */
  universeLabel?: string
  /**
   * Section ids this page actually renders. Anchors for anything else
   * are left out, so no tab scrolls to nothing. Omitted = all.
   */
  available?: string[]
  /** Explore runs wider than reading pages; its bar follows. */
  wide?: boolean
}

export function SiteNav({
  anchorBase = '/',
  showSections = true,
  artistName,
  includePlay = false,
  includeBeyond = false,
  universeLabel,
  available,
  wide = false,
}: SiteNavProps) {
  const base = anchorBase === '/' ? '' : anchorBase
  const sections = [
    SECTIONS[0],
    ...(includePlay ? [{ id: 'play', label: 'Play' }] : []),
    ...SECTIONS.slice(1),
    ...(includeBeyond ? [{ id: 'beyond', label: 'Beyond' }] : []),
    ...(universeLabel ? [{ id: 'universe', label: universeLabel }] : []),
  ].filter(
    (section) =>
      !available || section.id === 'top' || available.includes(section.id),
  )

  return (
    <>
      <header
        className={`${styles.bar} ${showSections ? styles.barWithSections : ''}`}
      >
        <div className={`${styles.inner} ${wide ? styles.innerWide : ''}`}>
          <Link className={styles.brand} href="/" aria-label="Ear Clef — Explore">
            <EarClefMark size={34} />
            <span className={styles.wordmark} aria-hidden="true">
              Ear Clef
            </span>
          </Link>
          <SiteNavLinks activeHref={showSections ? '/artists' : undefined} />
        </div>
      </header>
      {showSections && (
        <nav
          className={styles.sections}
          aria-label={artistName ? `${artistName} sections` : 'Page sections'}
        >
          <div className={styles.sectionsInner}>
            {artistName && (
              <a className={styles.sectionsName} href={`${base}#top`}>
                {artistName}
              </a>
            )}
            <ul className={styles.sectionLinks}>
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    className={styles.sectionLink}
                    href={`${base}#${section.id}`}
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      )}
    </>
  )
}
