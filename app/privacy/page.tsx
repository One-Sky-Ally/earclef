import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './privacy.module.css'

export const metadata: Metadata = {
  title: 'Privacy — Ear Clef',
  description: 'What Ear Clef stores, and what it never does with it.',
}

export default function PrivacyPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>The plain-English version</p>
          <h1 className={styles.title}>Privacy</h1>

          <div className={styles.prose}>
            <h2>What we store</h2>
            <p>
              If you sign in, follow artists, or join an artist&rsquo;s
              membership, we store your email address, the artists you
              follow, and your membership dates. That is the whole list —
              there are no profiles, no passwords, and no tracking of what
              you read or play.
            </p>

            <h2>Cookies</h2>
            <p>
              One cookie, set only when you sign in, so the site recognizes
              you when you return. No analytics cookies, no advertising
              cookies, no third-party trackers.
            </p>

            <h2>Email</h2>
            <p>
              We send sign-in links when you ask for one, one reminder
              before a membership year ends, and one note after it ends.
              Nothing renews on its own, and there is no mailing list.
            </p>

            <h2>Payments</h2>
            <p>
              Payments are handled by Stripe on Stripe&rsquo;s own pages —
              card numbers never touch Ear Clef. We keep only the fact that
              a membership year was paid for and when it ends.
            </p>

            <h2>Who touches the data</h2>
            <p>
              The site runs on Netlify, email goes through Resend, and
              payments go through Stripe. Nobody&rsquo;s data is sold,
              shared, or used for anything beyond running the features
              described above.
            </p>

            <h2>Deletion</h2>
            <p>
              Want your email and follows gone? Write to{' '}
              <a href="mailto:oneskyally@gmail.com">oneskyally@gmail.com</a>{' '}
              and it will be deleted.
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
