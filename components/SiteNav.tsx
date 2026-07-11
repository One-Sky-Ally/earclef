import { EarClefMark } from '@/components/EarClefMark'
import styles from './SiteNav.module.css'

const SECTIONS = [
  { href: '#listen', label: 'Listen' },
  { href: '#watch', label: 'Watch' },
  { href: '#story', label: 'Story' },
  { href: '#shows', label: 'Shows' },
  { href: '#merch', label: 'Merch' },
  { href: '#press', label: 'Press' },
]

export function SiteNav() {
  return (
    <nav className={styles.nav} aria-label="Page sections">
      <div className={`container ${styles.inner}`}>
        <a className={styles.brand} href="#top">
          <EarClefMark size={22} />
          <span>Ear Clef</span>
        </a>
        <ul className={styles.links}>
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <a className={styles.link} href={section.href}>
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
