import Link from 'next/link'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './SiteFooterSimple.module.css'

/** The quiet footer for the site's own pages (Explore, Feed, On this day). */
export function SiteFooterSimple() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="Ear Clef — Explore">
          <EarClefMark size={30} />
          <span className={styles.tagline}>Music in balance</span>
        </Link>
        <nav aria-label="About Ear Clef">
          <ul className={styles.links}>
            <li>
              <Link href="/manifesto">Manifesto</Link>
            </li>
            <li>
              <Link href="/for-artists">For artists</Link>
            </li>
            <li>
              <Link href="/get-on-the-map">Get on the map</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
