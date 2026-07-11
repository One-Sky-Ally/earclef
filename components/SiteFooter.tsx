import type { FooterContent } from '@/lib/types'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './SiteFooter.module.css'

interface SiteFooterProps {
  footer: FooterContent
}

export function SiteFooter({ footer }: SiteFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <span className={styles.mark}>
          <EarClefMark size={52} label="Ear Clef" />
        </span>
        <p className={styles.tagline}>{footer.tagline}</p>
        <p className={styles.attribution}>{footer.attribution}</p>
      </div>
    </footer>
  )
}
