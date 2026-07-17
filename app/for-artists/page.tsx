import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './forArtists.module.css'

export const metadata: Metadata = {
  title: 'For artists — Ear Clef',
  description:
    'The Ear Clef deal for artists: direct pay from your fans, honest expiry by default, your price, your page, your rhythm. Come claim your universe.',
}

const DEAL = [
  {
    title: 'Direct pay',
    body: 'Your fans pay you through your own Stripe account. The money never passes through Ear Clef — we don’t touch it and we don’t take a cut.',
  },
  {
    title: 'Honest expiry',
    body: 'No auto-renewal is the platform default: a year ends, your fan gets one reminder, and choosing you again is a decision, not an oversight. How you charge is yours to decide — whatever you choose is labeled clearly before anyone pays.',
  },
  {
    title: 'Your price, your page, your people',
    body: 'You set the price. You own the page. The fan relationships are yours — names, not algorithm-mediated impressions.',
  },
  {
    title: 'Rest is built in',
    body: 'Six months on and six off, or whatever your life needs. The promise to fans isn’t content forever; it’s honesty about the season.',
  },
]

const PERKS = [
  'New work as it happens — demos, b-sides, sketches',
  'The next album early, and the back catalog to keep',
  'Stems, to remix or pull apart and learn from',
  'Tabs and how-to-play videos, taught by the hands that wrote the part',
  'Live video hangs and lessons',
  'Members-only merch, and real discounts on the rest',
  'Fan-made merch and art — artist-approved, profits split',
  'Presales, ticket discounts, early entry',
  'Live streams — full shows or the living-room kind',
  'Meetups and takeovers in real life',
  'Contests worth entering, with real names on real work',
]

export default function ForArtistsPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>For artists</p>
          <h1 className={styles.title}>Come claim your universe.</h1>
          <p className={styles.subtitle}>
            One page that gathers your whole world — music, videos,
            discography, shows, story, merch — and a membership model built
            around a different deal. Read the{' '}
            <Link href="/manifesto">manifesto</Link>
            {' for the why; here’s the what.'}
          </p>

          <section className={styles.section} aria-labelledby="deal-heading">
            <h2 id="deal-heading" className={styles.heading}>
              The deal
            </h2>
            <div className={styles.dealGrid}>
              {DEAL.map((item) => (
                <article key={item.title} className={styles.dealCard}>
                  <h3 className={styles.dealTitle}>{item.title}</h3>
                  <p className={styles.dealBody}>{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="perks-heading">
            <h2 id="perks-heading" className={styles.heading}>
              The perks palette
            </h2>
            <p className={styles.sectionNote}>
              What your members-only universe can hold — a menu of ideas, not
              a checklist. Offer what fits you; skip what doesn&rsquo;t.
            </p>
            <ul className={styles.perks}>
              {PERKS.map((perk) => (
                <li key={perk} className={styles.perk}>
                  {perk}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="wish-heading">
            <h2 id="wish-heading" className={styles.heading}>
              Fans are already wishing artists here
            </h2>
            <p className={styles.sectionNote}>
              The roster grows by request — fans{' '}
              <Link href="/suggest">wish artists onto Ear Clef</Link>, and
              every page is built with verified links and an honest story.
              Yours might already be on the list.
            </p>
          </section>

          <section className={styles.cta} aria-labelledby="cta-heading">
            <h2 id="cta-heading" className={styles.ctaTitle}>
              Ready when you are
            </h2>
            <p className={styles.sectionNote}>
              Artist self-serve is on its way; today it starts with a
              conversation. Tell us who you are and where your music lives,
              and we&rsquo;ll build your page with you.
            </p>
            <a
              className={styles.ctaButton}
              href="mailto:oneskyally@gmail.com?subject=Ear%20Clef%20—%20artist%20page"
            >
              Reach out — oneskyally@gmail.com
            </a>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <EarClefMark size={30} label="Ear Clef" />
        <p>Music in balance</p>
      </footer>
    </>
  )
}
