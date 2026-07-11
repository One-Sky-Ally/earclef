import type { PastShow, ShowsContent, UpcomingShow } from '@/lib/types'
import { byDateAscending, byDateDescending, formatShowDate } from '@/lib/format'
import { SectionHeader } from '@/components/SectionHeader'
import styles from './Shows.module.css'

interface ShowsProps {
  shows: ShowsContent
}

function UpcomingRow({ show }: { show: UpcomingShow }) {
  return (
    <li className={styles.row}>
      <span className={styles.date}>{formatShowDate(show.date)}</span>
      <span className={styles.venue}>
        {show.venue}
        <span className={styles.city}>{show.city}</span>
        {show.note && <span className={styles.note}>{show.note}</span>}
      </span>
      {show.ticketUrl && (
        <a
          className={styles.action}
          href={show.ticketUrl}
          target="_blank"
          rel="noreferrer"
        >
          Tickets ↗
        </a>
      )}
    </li>
  )
}

function PastRow({ show }: { show: PastShow }) {
  return (
    <li className={styles.row}>
      <span className={styles.date}>{formatShowDate(show.date)}</span>
      <span className={styles.venue}>
        {show.venue}
        <span className={styles.city}>{show.city}</span>
        {show.note && <span className={styles.note}>{show.note}</span>}
        {show.songs && show.songs.length > 0 && (
          <details className={styles.songs}>
            <summary>Setlist ({show.songs.length} songs)</summary>
            <ol>
              {show.songs.map((song) => (
                <li key={song}>{song}</li>
              ))}
            </ol>
          </details>
        )}
      </span>
      {show.setlistUrl && (
        <a
          className={styles.action}
          href={show.setlistUrl}
          target="_blank"
          rel="noreferrer"
        >
          Setlist ↗
        </a>
      )}
    </li>
  )
}

export function Shows({ shows }: ShowsProps) {
  const upcoming = byDateAscending(shows.upcoming)
  const past = byDateDescending(shows.past)

  return (
    <section id="shows" className="section" aria-labelledby="shows-heading">
      <div className="container">
        <SectionHeader number="04" title="Shows" headingId="shows-heading" />

        <h3 className={styles.subheading}>Upcoming</h3>
        {upcoming.length > 0 ? (
          <ul className={styles.list}>
            {upcoming.map((show) => (
              <UpcomingRow key={`${show.date}-${show.venue}`} show={show} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            {shows.upcomingNote ?? 'No upcoming shows announced.'}
          </p>
        )}

        {past.length > 0 && (
          <>
            <h3 className={styles.subheading}>Past shows &amp; setlists</h3>
            <ul className={styles.list}>
              {past.map((show) => (
                <PastRow key={`${show.date}-${show.venue}`} show={show} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
