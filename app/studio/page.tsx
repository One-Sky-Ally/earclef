import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import { StudioClient } from '@/components/studio/StudioClient'
import styles from './studio.module.css'

export const metadata: Metadata = {
  title: 'Curation Studio — Ear Clef',
  description: 'Owner tools for the Ear Clef roster.',
  robots: { index: false, follow: false },
}

export default function StudioPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>Owner tools</p>
          <h1 className={styles.title}>Curation Studio</h1>
          <StudioClient />
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
