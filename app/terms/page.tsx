import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from '../privacy/privacy.module.css'

export const metadata: Metadata = {
  title: 'Terms — Ear Clef',
  description: 'The plain-English terms for using Ear Clef.',
}

/**
 * Owner-approved wording, Nov 19 2026. YouTube's Developer Policies
 * (III.A.1) require a link to the YouTube Terms of Service and a line
 * binding users to them. A Memberships line was approved on the condition
 * that memberships can really be bought; Stripe is still in test mode, so
 * it is left out until they can.
 */
export default function TermsPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>The plain-English version</p>
          <h1 className={styles.title}>Terms</h1>

          <div className={styles.prose}>
            <p>Last updated November 19, 2026.</p>

            <h2>Using Ear Clef</h2>
            <p>
              Ear Clef is free to explore and listen to. It is built from
              public music records — MusicBrainz, Discogs, Wikipedia and
              Wikidata, and artists&rsquo; own sites — and we work to get
              every detail right. If something is wrong, tell us and
              we&rsquo;ll fix it.
            </p>

            <h2>Music from YouTube</h2>
            <p>
              Songs play in YouTube&rsquo;s own player, and the site uses
              YouTube API Services to find them. By using Ear Clef you agree
              to be bound by the{' '}
              <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
              Videos belong to the people who made and uploaded them; Ear
              Clef only points to them.
            </p>

            <h2>Privacy</h2>
            <p>
              The <Link href="/privacy">Privacy</Link> page explains what Ear
              Clef stores and what it never does with it. The{' '}
              <a href="https://policies.google.com/privacy">Google Privacy Policy</a>{' '}
              covers what YouTube collects.
            </p>

            <h2>What you send us</h2>
            <p>
              When you suggest an artist or put yourself on the map, you
              confirm the details are yours to share and true as far as you
              know.
            </p>

            <h2>Changes and questions</h2>
            <p>
              If these terms change, the date at the top changes with them.
              Questions go to{' '}
              <a href="mailto:oneskyally@gmail.com">oneskyally@gmail.com</a>.
            </p>
          </div>
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
