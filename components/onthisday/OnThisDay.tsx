'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { OnThisDayItem, OnThisDayPayload } from '@/lib/explore/onThisDay'
import styles from './OnThisDay.module.css'

/**
 * "On this day" (owner, Oct 10 2026). The visitor's OWN today by default
 * (their clock, not the server's), any other day on request — a birthday.
 * Only exact release dates are in the data, and the page says plainly how
 * many there are and how few are old: exact days are a modern habit.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/**
 * Below this share of a day's exact dates coming from before 2000, the
 * page says why the past looks thin (most days: around one in ten).
 */
const FEW_OLD_SHARE = 0.15

const pad = (value: number) => String(value).padStart(2, '0')
const localToday = () => {
  const now = new Date()
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
const label = (monthDay: string) => {
  const [month, day] = monthDay.split('-').map(Number)
  return `${MONTHS[month - 1]} ${day}`
}
const formatCount = (value: number) => value.toLocaleString('en-US')

/** The visitor's date, read on their device; null while rendering on the server. */
const subscribeToNothing = () => () => {}
const useLocalToday = () => useSyncExternalStore(subscribeToNothing, localToday, () => null)

/** The last answer, tagged with the date it answers — loading is "no answer for this date yet". */
type Answer =
  | { date: string; payload: OnThisDayPayload }
  | { date: string; error: true }

function itemHref(item: OnThisDayItem): { href: string; external: boolean } | null {
  if (item.a) return { href: `/a/${item.a}`, external: false }
  if (item.dg) return { href: `https://www.discogs.com/release/${item.dg}`, external: true }
  return null
}

function Item({ item, countryName }: { item: OnThisDayItem; countryName: string }) {
  const target = itemHref(item)
  const artist = target ? (
    target.external ? (
      <a href={target.href} target="_blank" rel="noopener noreferrer">{item.n}</a>
    ) : (
      <Link href={target.href}>{item.n}</Link>
    )
  ) : (
    item.n
  )
  return (
    <li className={styles.item}>
      <span className={styles.year}>{item.y}</span>
      <span className={styles.what}>
        <span className={styles.release}>{item.t}</span>
        <span className={styles.kind}>{item.k}</span>
        <span className={styles.by}>
          {artist} ·{' '}
          <Link className={styles.place} href={`/?y=${item.y}&c=${item.c}`}>
            {countryName}
          </Link>
        </span>
      </span>
    </li>
  )
}

export function OnThisDay({ initialDate }: { initialDate: string | null }) {
  const today = useLocalToday()
  const [chosen, setChosen] = useState<string | null>(initialDate)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [oldOnly, setOldOnly] = useState(false)
  // No date in the URL: the visitor's own today.
  const date = chosen ?? today

  useEffect(() => {
    if (date === null) return
    let cancelled = false
    const url = new URL(window.location.href)
    url.searchParams.set('d', date)
    window.history.replaceState(null, '', url)
    fetch(`/api/on-this-day/${date}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((payload: OnThisDayPayload) => {
        if (!cancelled) setAnswer({ date, payload })
      })
      .catch(() => {
        if (!cancelled) setAnswer({ date, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [date])

  const current = answer && answer.date === date ? answer : null
  const setDate = setChosen
  const [month, day] = (date ?? '01-02').split('-').map(Number)
  const setMonth = (next: number) => setDate(`${pad(next)}-${pad(Math.min(day, DAYS_IN_MONTH[next - 1]))}`)
  const setDay = (next: number) => setDate(`${pad(month)}-${pad(next)}`)

  return (
    <section className={styles.wrap} aria-live="polite">

      <div>
        <p className={styles.overline}>On this day</p>
        <h1 className={styles.title}>{date ? label(date) : 'Today'}</h1>
      </div>

      <form className={styles.picker} onSubmit={(event) => event.preventDefault()}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Month</span>
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Day</span>
          <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
            {Array.from({ length: DAYS_IN_MONTH[month - 1] }, (_, index) => (
              <option key={index + 1} value={index + 1}>{index + 1}</option>
            ))}
          </select>
        </label>
        <button type="button" className={styles.today} onClick={() => setDate(localToday())}>
          Today
        </button>
      </form>

      {!current && <p className={styles.note}>Looking through the catalogues…</p>}
      {current && 'error' in current && (
        <p className={styles.note}>This day could not be loaded. Try again in a moment.</p>
      )}
      {current && 'payload' in current && (
        <DayView payload={current.payload} oldOnly={oldOnly} setOldOnly={setOldOnly} />
      )}
    </section>
  )
}

function DayView({
  payload,
  oldOnly,
  setOldOnly,
}: {
  payload: OnThisDayPayload
  oldOnly: boolean
  setOldOnly: (value: boolean) => void
}) {
  const decades = useMemo(
    () => Object.entries(payload.byDecade).sort(([a], [b]) => Number(a) - Number(b)),
    [payload],
  )
  const before2000 = decades
    .filter(([decade]) => Number(decade) < 2000)
    .reduce((sum, [, count]) => sum + count, 0)
  const countries = Object.keys(payload.byCountry).length
  const shown = payload.items.filter((item) => !oldOnly || item.y < 2000)

  // January 1 is left out by rule, not by absence: say which.
  if (payload.date === '01-01') {
    return (
      <p className={styles.summary}>
        January 1 is the one day this page leaves out. Catalogues fill it in when
        only the year of a record is known, so a January 1 date cannot be told apart
        from a guess. Pick any other day.
      </p>
    )
  }

  if (payload.total === 0) {
    return (
      <p className={styles.summary}>
        No release in our sources carries this exact date. That is not the same as
        nothing happening on {label(payload.date)} — most catalogues record only the
        year a record came out.
      </p>
    )
  }

  const grouped = new Map<string, OnThisDayItem[]>()
  for (const item of shown) {
    const decade = String(Math.floor(item.y / 10) * 10)
    grouped.set(decade, [...(grouped.get(decade) ?? []), item])
  }

  return (
    <>
      <p className={styles.summary}>
        {formatCount(payload.total)} release{payload.total === 1 ? '' : 's'} by artists on
        Ear Clef carry this exact date, from {countries} {countries === 1 ? 'country' : 'countries'}
        {before2000 > 0 ? `; ${formatCount(before2000)} from before 2000` : '; none from before 2000'}.
      </p>
      {before2000 < payload.total * FEW_OLD_SHARE && (
        <p className={styles.honest}>
          Older records are thin here, and that is the sources, not the music: exact
          release days were rarely written down before the 1990s, so most of the past
          only appears in its year, not on its day.
        </p>
      )}
      <label className={styles.toggle}>
        <input type="checkbox" checked={oldOnly} onChange={(event) => setOldOnly(event.target.checked)} />
        Only before 2000
      </label>

      {shown.length === 0 && (
        <p className={styles.note}>Nothing from before 2000 carries this exact date.</p>
      )}
      {[...grouped.entries()].map(([decade, items]) => {
        const all = payload.byDecade[decade] ?? items.length
        return (
          <div key={decade} className={styles.decade}>
            <h2 className={styles.decadeTitle}>
              {decade}s
              <span className={styles.decadeCount}>
                {items.length < all
                  ? `${items.length} of ${formatCount(all)} shown`
                  : `${formatCount(all)} with this exact date`}
              </span>
            </h2>
            <ul className={styles.list}>
              {items.map((item) => (
                <Item
                  key={`${item.a ?? item.dg}-${item.y}-${item.t}`}
                  item={item}
                  countryName={payload.countryNames[item.c] ?? item.c}
                />
              ))}
            </ul>
          </div>
        )
      })}

      <p className={styles.method}>
        Only exact release dates are used: the first release date of an original album,
        single or EP in MusicBrainz, and the original Discogs release for the archive&rsquo;s
        sparse-catalogue places. Year- or month-only dates are left out, and so is
        January 1, which catalogues often fill in when only the year is known. Where
        a decade has more than {payload.perDecade} releases, countries take turns — each
        one&rsquo;s most-followed artist first — so no single place fills the list.
      </p>
    </>
  )
}
