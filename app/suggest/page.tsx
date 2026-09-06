import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import Link from 'next/link'
import { SuggestForm } from '@/components/SuggestForm'
import styles from './suggest.module.css'

export const metadata: Metadata = {
  title: 'Suggest an artist — Ear Clef',
  description:
    'Tell us who belongs on the Ear Clef roster. Every suggestion gets a real listen.',
}

export default function SuggestPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>Grow the roster</p>
          <h1 className={styles.title}>Suggest an artist</h1>
          <p className={styles.subtitle}>
            Who belongs here? Every suggestion gets a real listen — additions
            go through the same verified research as the rest of the roster.
            Suggesting yourself, and not on the globe yet?{' '}
            <Link href="/get-on-the-map">Get on the map</Link> first.
          </p>
          <SuggestForm />
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
