import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './privacy.module.css'

export const metadata: Metadata = {
  title: 'Privacy — Ear Clef',
  description: 'What Ear Clef stores, and what it never does with it.',
}

/**
 * Every statement here was checked against the code (Nov 19 2026):
 * signed-out saves live in localStorage (lib/fans/likesStorage.ts,
 * components/listen/ServiceProvider.tsx); the signed-in record is
 * lib/fans/store.ts FanRecord; the one cookie is lib/membership/session.ts
 * (180 days); error reports are lib/clientLog.ts; every YouTube player
 * embeds from youtube-nocookie.com; saved YouTube facts are re-read within
 * 30 days (lib/play/queue/cacheEntry.ts + sweep.ts); play/save/share
 * counts are lib/tally/ (Nov 22 2026); the Discover artists you've
 * played are lib/discover/played.ts, this browser only, never sent
 * (Nov 23 2026). Change the code, check this page.
 */
export default function PrivacyPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>The plain-English version</p>
          <h1 className={styles.title}>Privacy</h1>

          <div className={styles.prose}>
            <h2>If you don&rsquo;t sign in</h2>
            <p>
              Nothing about you is stored on our servers. Your liked songs,
              the artists you take off your radar, your choice of listening
              service, and which Discover artists you&rsquo;ve played are
              kept in your own browser, so the site
              remembers them on this device without an account. Clearing
              this site&rsquo;s data in your browser removes them.
            </p>

            <h2>If you sign in</h2>
            <p>
              Signing in works with a link sent to your email — there are no
              passwords. Your account keeps your email address, the artists
              you follow and the tier you put each one in, your liked songs
              (with the place and year that were playing, and when you liked
              them), the artists you take off your radar, and your choice of
              listening service, so they follow you to any device. A copy of
              your likes and your listening service also stays in your
              browser, so pages show them straight away. Which Discover
              artists you&rsquo;ve played is not part of your account: it
              stays only in the browser where you played them, even when
              you&rsquo;re signed in, so it doesn&rsquo;t follow you to other
              devices. If you hold an
              artist&rsquo;s membership, we also keep its dates (see
              Payments).
            </p>
            <p>
              On our servers, nothing ties what you play or read to you —
              only what you choose to save is kept. Sharing your taste map is off unless
              you turn it on. If you do, a public page shows the name you
              choose (never your email), the artists you follow grouped by
              your tiers, and your first-fan numbers. Turn sharing off and
              that page is gone.
            </p>

            <h2>Discover artists you&rsquo;ve played</h2>
            <p>
              So the{' '}
              <Link href="/discover/past">past picks</Link> page can show
              which recommended artists you&rsquo;ve already heard, your
              browser remembers each one you press play on in Discover, or
              mark as played yourself: the artist&rsquo;s MusicBrainz id and
              the day, nothing else. It is never sent to Ear Clef or anyone
              else, and nobody but you can see it. Clearing this site&rsquo;s
              data in your browser removes it.
            </p>

            <h2>Cookies</h2>
            <p>
              Ear Clef sets one cookie, only when you sign in, so the site
              recognizes you when you return. It lasts up to 180 days, or
              until you sign out. No analytics cookies, no advertising
              cookies. YouTube&rsquo;s player can set its own cookies once
              you play a video — see Music from YouTube below.
            </p>

            <h2>Music from YouTube</h2>
            <p>
              Ear Clef plays music through YouTube. To find and check songs,
              the site uses YouTube API Services, and every song plays in
              YouTube&rsquo;s own player. The player loads from
              YouTube&rsquo;s privacy-enhanced address
              (youtube-nocookie.com), so YouTube stores nothing in your
              browser until you press play. Once a video plays, what YouTube
              collects is covered by the{' '}
              <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
              Ear Clef asks YouTube about songs, never about you, and sends
              YouTube nothing about you. By playing music on Ear Clef you
              also agree to{' '}
              <a href="https://www.youtube.com/t/terms">YouTube&rsquo;s Terms of Service</a>.
            </p>

            <h2>Analytics and error reports</h2>
            <p>
              We use Cloudflare Web Analytics to count page views in
              aggregate — which pages get read, roughly how many people
              visit. It sets no cookies, uses no fingerprinting, and
              cannot follow you as an individual, here or anywhere else.
              We see totals, never people.
            </p>
            <p>
              We also count how often songs are played, saved and shared, so
              we can see which parts of Ear Clef people use. Each count says
              only what happened (a play, a save or a share) and which part
              of the site it happened on, such as the Feed or an artist
              page. It carries no name, account, cookie, IP address, device
              details or song, and counts are never linked to each other —
              we keep daily totals and nothing else. If your browser sends
              Global Privacy Control or Do Not Track, nothing is counted.
            </p>
            <p>
              If part of the site breaks in your browser, it sends a short
              error report — what failed, and your browser&rsquo;s name and
              version — to our server logs so it can be fixed. It carries
              nothing about who you are.
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
              card numbers never touch Ear Clef. For a membership we keep
              when it started and when it ends, and Stripe&rsquo;s reference
              for the payment.
            </p>

            <h2>Artists who get on the map</h2>
            <p>
              When an artist puts themselves on the map, we keep their
              MusicBrainz id, the page they proved control of, the code they
              placed there, and the date we saw it — as the{' '}
              <Link href="/get-on-the-map">Get on the map</Link> page
              describes.
            </p>

            <h2>Who touches the data</h2>
            <p>
              The site runs on Netlify, email goes through Resend,
              payments go through Stripe, aggregate page counts go
              through Cloudflare, play, save and share totals are kept on
              Netlify, and songs play through YouTube (Google).
              Nobody&rsquo;s data is sold, shared, or used for anything
              beyond running the features described above.
            </p>

            <h2>Deletion</h2>
            <p>
              Not signed in? Clear this site&rsquo;s data in your browser and
              everything Ear Clef kept for you is gone. Signed in? Write to{' '}
              <a href="mailto:oneskyally@gmail.com">oneskyally@gmail.com</a>{' '}
              and your account — email, follows, tiers, likes, settings and
              any membership records — will be deleted. The list of Discover
              artists you&rsquo;ve played was never on our servers; clear
              this site&rsquo;s data in your browser to remove it.
            </p>
            <p>
              Song details Ear Clef gets from YouTube — video links and
              titles — are re-checked at least every 30 days and removed
              when YouTube no longer has them.
            </p>

            <p>
              See also the <Link href="/terms">Terms</Link>.
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
