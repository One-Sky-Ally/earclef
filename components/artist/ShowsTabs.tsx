'use client'

import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { PastShow, ShowsContent, UpcomingShow } from '@/lib/types'
import { formatShowDate } from '@/lib/format'
import { localIsoDate, splitShows } from '@/lib/shows'
import { LinkifiedText } from '@/components/LinkifiedText'
import styles from '@/components/Shows.module.css'

type Tab = 'upcoming' | 'past'

/** The date only matters once per visit; nothing to listen for. */
const subscribeToNothing = () => () => {}
const TABS: Tab[] = ['upcoming', 'past']

interface ShowsTabsProps {
  shows: ShowsContent
  artistName: string
  /** The day the page was built — the client re-sorts with its own date. */
  builtOn: string
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
        <a className={styles.action} href={show.ticketUrl} target="_blank" rel="noreferrer">
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
              {show.songs.map((song, index) => (
                <li key={`${index}-${song}`}>{song}</li>
              ))}
            </ol>
          </details>
        )}
      </span>
      {show.setlistUrl && (
        <a className={styles.action} href={show.setlistUrl} target="_blank" rel="noreferrer">
          Setlist ↗
        </a>
      )}
    </li>
  )
}

/**
 * Live & setlists as one panel: Upcoming and Past tabs over the shows on
 * record. An empty tab is never left blank — it says plainly that there is
 * nothing on record, rather than implying a quiet schedule we haven't seen.
 */
export function ShowsTabs({ shows, artistName, builtOn }: ShowsTabsProps) {
  // The page is built ahead of time, so the date it was built on can go
  // stale. Re-sort with the listener's own date once the page is open.
  const today = useSyncExternalStore(
    subscribeToNothing,
    localIsoDate,
    () => builtOn,
  )

  const { upcoming, past, noteStillHolds } = splitShows(shows, today)
  const [chosen, setChosen] = useState<Tab | null>(null)
  const active: Tab = chosen ?? (upcoming.length > 0 ? 'upcoming' : 'past')

  const baseId = useId()
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    upcoming: null,
    past: null,
  })

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.indexOf(active)
    let next: Tab | null = null
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length]
    if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length]
    if (event.key === 'Home') next = TABS[0]
    if (event.key === 'End') next = TABS[TABS.length - 1]
    if (!next) return
    event.preventDefault()
    setChosen(next)
    tabRefs.current[next]?.focus()
  }

  const counts: Record<Tab, number> = { upcoming: upcoming.length, past: past.length }
  const labels: Record<Tab, string> = { upcoming: 'Upcoming', past: 'Past' }

  return (
    <div>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={`${artistName} live shows`}
        onKeyDown={onKeyDown}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            ref={(node) => {
              tabRefs.current[tab] = node
            }}
            id={`${baseId}-${tab}-tab`}
            type="button"
            role="tab"
            aria-selected={active === tab}
            aria-controls={`${baseId}-${tab}-panel`}
            tabIndex={active === tab ? 0 : -1}
            className={`${styles.tab} ${active === tab ? styles.tabActive : ''}`}
            onClick={() => setChosen(tab)}
          >
            {labels[tab]}
            <span className={styles.count}>
              {counts[tab] > 0 ? counts[tab] : 'none on record'}
            </span>
          </button>
        ))}
      </div>

      <div
        id={`${baseId}-upcoming-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-upcoming-tab`}
        hidden={active !== 'upcoming'}
        className={styles.tabPanel}
      >
        {upcoming.length > 0 ? (
          <ul className={styles.list}>
            {upcoming.map((show) => (
              <UpcomingRow key={`${show.date}-${show.venue}`} show={show} />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>
              We have no upcoming shows on record for {artistName}.
            </p>
            {shows.upcomingNote && noteStillHolds ? (
              <p className={styles.emptyNote}>
                <LinkifiedText text={shows.upcomingNote} />
              </p>
            ) : shows.upcoming.length > 0 ? (
              <p className={styles.emptyNote}>
                The dates we had listed have all gone by, so they now sit under Past.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div
        id={`${baseId}-past-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-past-tab`}
        hidden={active !== 'past'}
        className={styles.tabPanel}
      >
        {past.length > 0 ? (
          <ul className={styles.list}>
            {past.map((show) => (
              <PastRow key={`${show.date}-${show.venue}`} show={show} />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>
              We have no past shows on record for {artistName} yet.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
