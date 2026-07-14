import Link from 'next/link'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './SiteNav.module.css'

const SECTIONS = [
  { id: 'listen', label: 'Listen' },
  { id: 'watch', label: 'Watch' },
  { id: 'story', label: 'Story' },
  { id: 'shows', label: 'Shows' },
  { id: 'merch', label: 'Merch' },
  { id: 'press', label: 'Press' },
]

const PAGES = [
  { href: '/', label: 'Explore' },
  { href: '/feed', label: 'Latest' },
  { href: '/artists', label: 'Artists' },
]

interface SiteNavProps {
  /** Path the section anchors belong to, e.g. "/" or "/bjork". */
  anchorBase?: string
  /** Hide section anchors on non-artist pages. */
  showSections?: boolean
  /** Artists with native audio get a Play anchor ahead of the rest. */
  includePlay?: boolean
}

export function SiteNav({
  anchorBase = '/',
  showSections = true,
  includePlay = false,
}: SiteNavProps) {
  const base = anchorBase === '/' ? '' : anchorBase
  const sections = includePlay
    ? [{ id: 'play', label: 'Play' }, ...SECTIONS]
    : SECTIONS

  return (
    <nav className={styles.nav} aria-label="Site">
      <div className={`container ${styles.inner}`}>
        <Link className={styles.brand} href="/">
          <EarClefMark size={22} />
          <span>Ear Clef</span>
        </Link>
        <ul className={styles.links}>
          {showSections &&
            sections.map((section) => (
              <li key={section.id}>
                <Link
                  className={styles.link}
                  href={`${base}#${section.id}`}
                >
                  {section.label}
                </Link>
              </li>
            ))}
          {PAGES.map((page) => (
            <li key={page.href}>
              <Link className={styles.link} href={page.href}>
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
