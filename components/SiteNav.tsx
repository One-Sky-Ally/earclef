import Link from 'next/link'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './SiteNav.module.css'

const SECTIONS = [
  { href: '/#listen', label: 'Listen' },
  { href: '/#watch', label: 'Watch' },
  { href: '/#story', label: 'Story' },
  { href: '/#shows', label: 'Shows' },
  { href: '/#merch', label: 'Merch' },
  { href: '/#press', label: 'Press' },
  { href: '/explore', label: 'Explore' },
]

export function SiteNav() {
  return (
    <nav className={styles.nav} aria-label="Page sections">
      <div className={`container ${styles.inner}`}>
        <Link className={styles.brand} href="/">
          <EarClefMark size={22} />
          <span>Ear Clef</span>
        </Link>
        <ul className={styles.links}>
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Link className={styles.link} href={section.href}>
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
