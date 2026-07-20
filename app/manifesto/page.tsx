import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './manifesto.module.css'

export const metadata: Metadata = {
  title: 'The new era music industry — Ear Clef',
  description:
    "Stefano Kajatt's manifesto: why music has no proper home on the internet, and what Ear Clef does about it — direct pay, honest expiry, artist-set rhythm.",
}

/**
 * Stefano's manifesto, published in his own words. Editorial policy:
 * the text below is his verbatim, with mechanical typo fixes only —
 * never rephrase, tighten, or reorder without his say-so.
 */
export default function ManifestoPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>Manifesto</p>
          <h1 className={styles.title}>The new era music industry</h1>
          <p className={styles.byline}>
            Stefano Kajatt — musician, Las Vegas. Founder of One Sky Ally.
          </p>

          <div className={styles.prose}>
            <p>
              Music doesn&rsquo;t have a proper home on the internet. The
              songs are on streaming apps, the music videos on YouTube, their
              bio on Wikipedia, the setlists on setlist.fm, the tickets on
              Ticketmaster, the merch buried three clicks deep on a site
              nobody visits. Various companies each own a sliver of every
              artist, spread across all corners of the internet.
            </p>
            <p>
              I spent all my internet using years wondering why nobody just
              built a one stop shop for all music. Then I realized why:
              hosting music means licensing, and licensing economics are so
              brutal that even Spotify barely turns a profit. The money
              that&rsquo;s supposed to hold music together is the thing
              keeping it in pieces — and it&rsquo;s the same reason most
              musicians I know can&rsquo;t pay rent from their music.
            </p>

            <p>
              So I took my notes from the past 15 years and with the help of
              AI finally advanced enough, built it. My ideas with AI handling
              the infrastructure.
            </p>
            <p>It&rsquo;s called Ear Clef, and it&rsquo;s live right now.</p>
            <p>
              Every artist gets one page, their music, videos, full
              discography, setlist history, shows, merch, story, all gathered
              in one place. A feed with no addicting
              &ldquo;doom-scroll&rdquo; style algorithm: just the artists you
              care about and everything that relates to them; new releases,
              press, tour announcements, new merch and so on. Another fun
              feature is a globe you can spin to explore a century of music
              from every country on Earth.
            </p>
            <p>And underneath it, a different deal:</p>
            <ul>
              <li>
                Fans support artists directly. The money goes from the fan to
                the artist. I don&rsquo;t touch it and I don&rsquo;t take a
                cut.
              </li>
              <li>
                My default is to have no auto-renews on my pages. If you love
                an artist, you choose them again next year, on purpose. I
                encourage every artist here to do the same, and the platform
                makes honest expiry the default, but each artist decides how
                they charge. Whatever they choose is labeled clearly, so fans
                always know the deal before they pay.
              </li>
              <li>
                Artists set their own price, own their own pages, own their
                fan relationships.
              </li>
              <li>
                Rest is built in. Artists set their own rhythm. Six months on
                and six off, or whatever their life needs. The promise to
                fans isn&rsquo;t content forever; it&rsquo;s honesty about
                the season.
              </li>
            </ul>

            <h2>What a subscription can actually be</h2>
            <p>
              When the money goes straight from fan to artist, being a
              subscriber stops meaning &ldquo;access to content&rdquo; and
              starts meaning a place in someone&rsquo;s creative life. Every
              artist offers what fits them, it&rsquo;s a menu of ideas to
              engage fans, not a checklist:
            </p>
            <ul>
              <li>
                New work as it happens — demos, b-sides, sketches, the stuff
                that usually dies on a hard drive
              </li>
              <li>The next album early, and the back catalog to keep</li>
              <li>The stems, to remix or pull apart and learn from</li>
              <li>
                Tabs and how-to-play videos, taught by the hands that wrote
                the part
              </li>
              <li>Live video hangs and lessons with the band</li>
              <li>Members-only merch, and real discounts on the rest</li>
              <li>
                Fan-made merch and art — artist-approved, profits split with
                the fans who made it
              </li>
              <li>Presales, ticket discounts, early entry</li>
              <li>
                Shows live-streamed when you can&rsquo;t be there, or humble
                live streams from their living room
              </li>
              <li>Meetups and takeovers in real life</li>
              <li>
                Contests worth entering: design the tour flyer for your city,
                cut the music video, remix the single, with your name on it
              </li>
            </ul>
            <p>
              Read that as a fan and you&rsquo;d pay for it. Read it as an
              artist and you realize how much you&rsquo;ve always had to
              give, the current music industry just never gave you a place to
              offer it.
            </p>
            <p>
              Three words have been under all of this since before I had a
              name for it: <strong>transparency, creativity, community.</strong>{' '}
              That&rsquo;s the whole compass.
            </p>

            <h2>What I want</h2>
            <p>
              I&rsquo;m a working musician, not a tech company. I built this
              with the help of AI (and a lot of late nights) because I got
              tired of waiting for someone else to.
            </p>
            <p>
              If you&rsquo;re an <strong>artist</strong> — especially
              independent — there&rsquo;s a home here for you. Come claim
              your artistic universe.
            </p>
            <p>
              If you&rsquo;re a <strong>fan</strong>, through Ear Clef you
              can actually connect with the artists you love and watch what a
              feed looks like when nobody&rsquo;s farming your attention.
            </p>
            <p>
              And if you run a <strong>platform</strong> — Spotify, Bandcamp,
              Apple, whoever — I&rsquo;m not hiding any of this. Take these
              ideas. Honest expiry, direct pay, artist-set rhythm. Build them
              into what you already have. Millions of artists would benefit
              tomorrow. And if you want help doing it right, hire me.
              I&rsquo;ve thought about this for over fifteen years and
              I&rsquo;ll consult for anyone serious about it.
            </p>
            <p>
              I care more that this exists than that I own it. With the
              caveat that my goal is to cut out the middle man as much as
              possible, because historically, middle men have undeservingly
              taken the lion&rsquo;s share of profits making artists feel
              like slaves and fans feel like a number.
            </p>
            <p className={styles.closing}>
              There is no ultimate music destination. I&rsquo;m building one
              anyway.
            </p>
            <p>
              <strong>earclef.com</strong> — come find me.
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
