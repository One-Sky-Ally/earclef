import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { EarClefMark } from '@/components/EarClefMark'
import styles from './getOnTheMap.module.css'

export const metadata: Metadata = {
  title: 'Get on the map — Ear Clef',
  description:
    'Not on Ear Clef yet? The site reads the open music catalogs. Add yourself to MusicBrainz in about ten minutes and every open project, this one included, can see where your music is from.',
}

const CONTACT = 'oneskyally@gmail.com'
const MAIL_SUBJECT = encodeURIComponent('Get on the map')
const MAIL_BODY = encodeURIComponent(
  'My MusicBrainz artist link:\n\n\nA page I control, for the code (Bandcamp, YouTube, or my own site):\n\n',
)
const MAILTO = `mailto:${CONTACT}?subject=${MAIL_SUBJECT}&body=${MAIL_BODY}`

const FIELDS = [
  {
    name: 'Area',
    body: 'The place your music belongs to. For a person, usually where you were born and raised; for a band, where it formed. If your music happened somewhere else, choose that. Pick a city when MusicBrainz has it: the city is what places you in a US state or a UK nation, and the country follows from it.',
  },
  {
    name: 'Begin area',
    body: 'Where you were born, or where the band formed. It can be the same place as Area.',
  },
  {
    name: 'Begin date',
    body: 'Your birth year, or the year the band formed. A year is enough. Without it the site cannot place you in an era, and eras are how people browse here.',
  },
]

const STEPS = [
  {
    title: 'Create a MusicBrainz account',
    body: (
      <>
        Free. A username, a password, and an email you check, then confirm
        the email.{' '}
        <a href="https://musicbrainz.org/register">Create the account.</a>
      </>
    ),
  },
  {
    title: 'Check you are not already there',
    body: (
      <>
        <a href="https://musicbrainz.org/search?type=artist">
          Search your name.
        </a>{' '}
        Someone may have added you. If a record exists, sign in and fill
        in the three fields above. If the name belongs to someone else,
        you will add a short note that tells you apart, like &ldquo;folk
        singer from Oaxaca&rdquo;.
      </>
    ),
  },
  {
    title: 'Add yourself as an artist',
    body: (
      <>
        From the Editing menu, choose{' '}
        <a href="https://musicbrainz.org/artist/create">Add artist</a>. Your
        name, whether you are a person or a group, then the three fields
        above. Add your links while you are there: your site, Bandcamp,
        YouTube, Spotify, Apple Music. Those links are how anyone later
        proves a record is really yours. In the edit note, say you are the
        artist.
      </>
    ),
  },
  {
    title: 'Add at least one release',
    body: (
      <>
        A single is enough. On your new artist page, choose &ldquo;Add
        release&rdquo;: title, year, and the tracklist. This step matters:
        MusicBrainz removes an artist that has no releases and no links.
      </>
    ),
  },
  {
    title: 'Optional: add yourself to Discogs',
    body: (
      <>
        <a href="https://www.discogs.com/">Discogs</a> is the second
        catalog this site reads, and digital releases are welcome there.
        It matters most in the countries where Ear Clef fills gaps from
        Discogs records.
      </>
    ),
  },
  {
    title: 'Tell us',
    body: (
      <>
        <a href={MAILTO}>Email your MusicBrainz link</a> and we will
        re-read your country. If you are in a country too big for the map
        to store in full, we will send you a short code so we can pin you.
        The next section explains that.
      </>
    ),
  },
]

const NEXT = [
  {
    title: 'Your name in search, soon',
    body: 'MusicBrainz usually catches up within hours. Search your name on the globe and your page opens with your releases, read live from the catalog.',
  },
  {
    title: 'Your country and region, at the next refresh',
    body: 'The country and region lists are rebuilt by hand, roughly weekly, and when you write to us. That is when you appear in them.',
  },
  {
    title: 'The big-country case',
    body: 'Fifty countries hold more artists than this site stores, and a new record has no community tags to rank on. There, once you have proved control of a page, you are guaranteed a place in your country’s list. Not the top of it: ranking comes from what the MusicBrainz community has tagged, the same for everyone.',
  },
  {
    title: 'What we cannot promise',
    body: 'A play button. Those come from an independent check that a recording is really yours, and nothing gets that from its own record. A page of your own on Ear Clef: those are still curated. Speed: MusicBrainz’s index and our refresh run on their own clocks.',
  },
]

const STORED = [
  {
    title: 'Nothing you type here',
    body: 'This page has no form. The email goes to a person’s inbox and stays there, with your address on it.',
  },
  {
    title: 'A copy of your public catalog record',
    body: 'Your MusicBrainz id, name, career years, and tags, the same compact record kept for every artist on the map. Public catalog data, refreshed from MusicBrainz.',
  },
  {
    title: 'If we pin you: the evidence',
    body: 'Your MusicBrainz id, the page you proved control of, the code, and the date we saw it. That record is what makes the pin a promise rather than a name in an email.',
  },
  {
    title: 'What you add to MusicBrainz is open',
    body: 'It is published under open licenses, under your username, publicly and permanently. That is the point: it lets every open project use it, this one included. Know that before you add.',
  },
]

export default function GetOnTheMapPage() {
  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>Get on the map</p>
          <h1 className={styles.title}>Not on the map yet?</h1>
          <p className={styles.subtitle}>
            Musicians look themselves up here and find nothing, with their
            music on every streaming service. Here is why, and the
            ten-minute fix.
          </p>

          <section className={styles.section} aria-labelledby="why-heading">
            <h2 id="why-heading" className={styles.heading}>
              Why you are not here
            </h2>
            <p className={styles.prose}>
              Ear Clef reads two open catalogs, MusicBrainz and Discogs,
              that anyone can add to and everyone can use. Streaming
              services know your songs but not where you are from, and their
              catalogs are not ours to copy. So if nobody has added you to
              the open catalogs, this site cannot see you.
            </p>
            <p className={styles.prose}>
              The fix is to add yourself. It is free, it takes about ten
              minutes, and it puts you into the commons every open music
              project reads from, not only this one.
            </p>
          </section>

          <section
            className={styles.section}
            aria-labelledby="fields-heading"
          >
            <div className={styles.callout}>
              <p id="fields-heading" className={styles.calloutTitle}>
                The three fields that matter here
              </p>
              <p className={styles.prose}>
                Ear Clef is a map. Where and when you appear on it comes
                from three fields on your MusicBrainz record. Everything else
                is optional.
              </p>
              <ul className={styles.fields}>
                {FIELDS.map((field) => (
                  <li key={field.name}>
                    <p className={styles.fieldName}>{field.name}</p>
                    <p className={styles.fieldBody}>{field.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="steps-heading">
            <h2 id="steps-heading" className={styles.heading}>
              The steps
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step) => (
                <li key={step.title} className={styles.step}>
                  <div>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepBody}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.prose} style={{ marginTop: '1.5rem' }}>
              Adding yourself goes live at once. MusicBrainz applies a new
              artist and its links automatically, with no vote to wait for.
              Changes to records that already exist can wait up to seven days
              for other editors to vote.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="next-heading">
            <h2 id="next-heading" className={styles.heading}>
              What happens next, honestly
            </h2>
            <ul className={styles.items}>
              {NEXT.map((item) => (
                <li key={item.title} className={styles.item}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="proof-heading">
            <h2 id="proof-heading" className={styles.heading}>
              Proving a page is yours
            </h2>
            <p className={styles.prose}>
              When you write, we send a short code. Put it somewhere only you
              can edit: your Bandcamp bio, your YouTube channel description,
              or a page on your own site. We look, record the page, the code
              and the date, and pin you. After that you can take the code
              down.
            </p>
            <p className={styles.prose}>
              We cannot check who you are, and we do not try. We check that
              you control the place your music lives. That is what the pin
              promises.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="stored-heading">
            <h2 id="stored-heading" className={styles.heading}>
              What Ear Clef keeps
            </h2>
            <ul className={styles.items}>
              {STORED.map((item) => (
                <li key={item.title} className={styles.item}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
            <p className={styles.prose} style={{ marginTop: '1rem' }}>
              The <Link href="/privacy">privacy note</Link> covers the rest
              of the site.
            </p>
          </section>

          <section className={styles.cta} aria-labelledby="cta-heading">
            <h2 id="cta-heading" className={styles.ctaTitle}>
              Done the steps?
            </h2>
            <p className={styles.prose}>
              Send your MusicBrainz link and, if you like, a page you control.
              A person reads it.
            </p>
            <a className={styles.ctaButton} href={MAILTO}>
              Email {CONTACT}
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
