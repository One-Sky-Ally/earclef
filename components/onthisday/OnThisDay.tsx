'use client'

import Link from 'next/link'
import { QueuePlayer } from '@/components/explore/QueuePlayer'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { OnThisDayItem, OnThisDayPayload } from '@/lib/explore/onThisDay'
import { isGenreLens } from '@/lib/explore/genreData'
import { Icon } from '@/components/ui/Icon'
import styles from './OnThisDay.module.css'

/**
 * "On this day" (owner, Oct 10 2026). The visitor's OWN today by default
 * (their clock, not the server's), any other day on request — a birthday.
 * Only exact release dates are in the data, and the page says plainly how
 * many there are and how few are old: exact days are a modern habit.
 *
 * Layout (UI handoff, Oct 2026): quiet — a date chooser, a readable list
 * of releases, and one "Now exploring" panel holding the only player on
 * the page: the day's shuffled playlist, or the one release chosen.
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

/** The calendar day before or after, wrapping the year (Feb 29 included). */
function stepDay(monthDay: string, step: 1 | -1): string {
  let [month, day] = monthDay.split('-').map(Number)
  day += step
  if (day < 1) {
    month = month === 1 ? 12 : month - 1
    day = DAYS_IN_MONTH[month - 1]
  } else if (day > DAYS_IN_MONTH[month - 1]) {
    month = month === 12 ? 1 : month + 1
    day = 1
  }
  return `${pad(month)}-${pad(day)}`
}

/**
 * A shuffle that is random per visit but stable while the page is open
 * (a re-render must not reshuffle a playing queue): mulberry32 seeded by
 * a per-visit random number mixed with the date.
 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1))
    ;[out[index], out[swap]] = [out[swap], out[index]]
  }
  return out
}

const dateSeed = (monthDay: string) => Number(monthDay.replace('-', ''))

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

const itemKey = (item: OnThisDayItem) => `${item.a ?? item.dg}-${item.y}-${item.t}`

function ArtistLink({ item }: { item: OnThisDayItem }) {
  const target = itemHref(item)
  if (!target) return <>{item.n}</>
  return target.external ? (
    <a href={target.href} target="_blank" rel="noopener noreferrer">
      {item.n}
    </a>
  ) : (
    <Link href={target.href}>{item.n}</Link>
  )
}

function Item({
  item,
  countryName,
  current,
  onPlay,
}: {
  item: OnThisDayItem
  countryName: string
  current: boolean
  onPlay: (item: OnThisDayItem) => void
}) {
  return (
    <li className={`${styles.item} ${current ? styles.itemCurrent : ''}`}>
      <span className={styles.what}>
        <span className={styles.release}>
          {item.t}
          <span className={styles.kind}>{item.k}</span>
        </span>
        <span className={styles.by}>
          <ArtistLink item={item} />
        </span>
      </span>
      <span className={`${styles.cell} ${styles.yearCell}`}>
        <span className={styles.cellValue}>{item.y}</span>
        <span className={styles.cellLabel}>Year</span>
      </span>
      <span className={`${styles.cell} ${styles.countryCell}`}>
        <Link className={styles.cellValue} href={`/?y=${item.y}&c=${item.c}`}>
          {countryName}
        </Link>
        <span className={styles.cellLabel}>Country</span>
      </span>
      <span className={styles.action}>
        {/* Only a verified video gets a play button (owner's standing rule). */}
        {item.v ? (
          <button
            type="button"
            className={styles.play}
            onClick={() => onPlay(item)}
            aria-label={`Play “${item.vs ?? item.t}” by ${item.n}`}
            aria-pressed={current}
          >
            <Icon name="play" size={16} />
          </button>
        ) : (
          <span className={styles.noPlay} title="No verified video for this release yet">
            —
          </span>
        )}
      </span>
    </li>
  )
}

export function OnThisDay({ initialDate }: { initialDate: string | null }) {
  const today = useLocalToday()
  const [chosen, setChosen] = useState<string | null>(initialDate)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [oldOnly, setOldOnly] = useState(false)
  // One random number per visit: the playlist's order is random, but a
  // re-render never reshuffles it.
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31))
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
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          On this day
          {date && <span className="visually-hidden">: {label(date)}</span>}
        </h1>
        <form
          className={styles.picker}
          onSubmit={(event) => event.preventDefault()}
          aria-label="Choose a day"
        >
          <button
            type="button"
            className={styles.step}
            onClick={() => date && setDate(stepDay(date, -1))}
            aria-label="Previous day"
            disabled={!date}
          >
            <Icon name="arrowLeft" size={18} />
          </button>
          <span className={styles.dateBox}>
            <Icon name="calendar" size={18} />
            <label>
              <span className="visually-hidden">Month</span>
              <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="visually-hidden">Day</span>
              <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
                {Array.from({ length: DAYS_IN_MONTH[month - 1] }, (_, index) => (
                  <option key={index + 1} value={index + 1}>{index + 1}</option>
                ))}
              </select>
            </label>
          </span>
          <button
            type="button"
            className={styles.step}
            onClick={() => date && setDate(stepDay(date, 1))}
            aria-label="Next day"
            disabled={!date}
          >
            <Icon name="arrowRight" size={18} />
          </button>
          <button type="button" className={styles.today} onClick={() => setDate(localToday())}>
            Today
          </button>
        </form>
      </div>

      <div aria-live="polite">
        {!current && <p className={styles.note}>Looking through the catalogues…</p>}
        {current && 'error' in current && (
          <p className={styles.note}>This day could not be loaded. Try again in a moment.</p>
        )}
      </div>
      {current && 'payload' in current && (
        <DayView
          key={current.payload.date}
          payload={current.payload}
          oldOnly={oldOnly}
          setOldOnly={setOldOnly}
          seed={seed}
        />
      )}
    </section>
  )
}

/**
 * The selected release's context: its verified year, country and genre,
 * each its own way into Explore, and one combined "music culture" door.
 * Nothing here is inferred — the year is the original release's, the
 * country the artist's on the site, the genres the artist's own tags.
 */
function Context({
  item,
  countryName,
}: {
  item: OnThisDayItem
  countryName: string
}) {
  const lens = item.genres.find((genre) => isGenreLens(genre))
  const cultureHref = `/?c=${item.c}&y=${item.y}${lens ? `&g=${encodeURIComponent(lens)}` : ''}`
  const source = itemHref(item)
  return (
    <div className={styles.context}>
      <ul className={styles.chips} aria-label="Explore this release's dimensions">
        <li>
          <Link className={styles.chip} href={`/?y=${item.y}`}>
            <span>
              <span className={styles.chipValue}>{item.y}</span>
              <span className={styles.chipLabel}>Year · first release</span>
            </span>
            <Icon name="arrowRight" size={14} />
          </Link>
        </li>
        <li>
          <Link className={styles.chip} href={`/?c=${item.c}`}>
            <span>
              <span className={styles.chipValue}>{countryName}</span>
              <span className={styles.chipLabel}>Artist’s country</span>
            </span>
            <Icon name="arrowRight" size={14} />
          </Link>
        </li>
        {item.genres.length > 0 && (
          <li>
            {lens ? (
              <Link className={styles.chip} href={`/?g=${encodeURIComponent(lens)}`}>
                <span>
                  <span className={styles.chipValue}>{lens}</span>
                  <span className={styles.chipLabel}>Genre</span>
                </span>
                <Icon name="arrowRight" size={14} />
              </Link>
            ) : (
              <span className={`${styles.chip} ${styles.chipStatic}`}>
                <span>
                  <span className={styles.chipValue}>{item.genres[0]}</span>
                  <span className={styles.chipLabel}>Genre · no globe lens yet</span>
                </span>
              </span>
            )}
          </li>
        )}
      </ul>
      <Link className={styles.culture} href={cultureHref}>
        More from this music culture
        <Icon name="arrowRight" size={16} />
      </Link>
      <p className={styles.cultureNote}>
        Opens {countryName} in {item.y} on the globe{lens ? `, through the ${lens} lens` : ''}.
        Where that year is thin, the panel offers nearby years — and says so.
      </p>
      {item.place && (
        <p className={styles.placeLine}>
          <Link href={item.place.href} title={item.place.title}>
            {item.place.label}
          </Link>
        </p>
      )}
      <p className={styles.sourceLine}>
        {item.t} ({item.k.toLowerCase()}) · first released {item.y}, exact date on
        record{' '}
        {source && (
          <>
            ·{' '}
            {source.external ? (
              <a href={source.href} target="_blank" rel="noopener noreferrer">
                Discogs release ↗
              </a>
            ) : (
              <Link href={source.href}>artist archive</Link>
            )}
          </>
        )}
      </p>
    </div>
  )
}

function DayView({
  payload,
  oldOnly,
  setOldOnly,
  seed,
}: {
  payload: OnThisDayPayload
  oldOnly: boolean
  setOldOnly: (value: boolean) => void
  seed: number
}) {
  // The one release chosen from the list; null = the day's playlist.
  const [selected, setSelected] = useState<OnThisDayItem | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const decades = useMemo(
    () => Object.entries(payload.byDecade).sort(([a], [b]) => Number(a) - Number(b)),
    [payload],
  )
  const before2000 = decades
    .filter(([decade]) => Number(decade) < 2000)
    .reduce((sum, [, count]) => sum + count, 0)
  const countries = Object.keys(payload.byCountry).length
  const shown = payload.items.filter((item) => !oldOnly || item.y < 2000)
  // The playlist: verified songs among what is SHOWN, in random order.
  const playlist = useMemo(
    () =>
      shuffled(
        payload.items.filter((item) => item.v),
        seed ^ dateSeed(payload.date),
      ).map((item) => ({
        videoId: item.v as string,
        title: item.vs ?? item.t,
        artistName: item.n,
        mbid: item.a ?? '',
        genres: item.genres,
        place: item.place,
        y: item.y,
      })),
    [payload, seed],
  )
  const playable = playlist.filter((track) => !oldOnly || track.y < 2000)

  function play(item: OnThisDayItem) {
    setSelected(item)
    // Stacked layout: the panel sits above the list — bring it into view.
    if (window.matchMedia('(max-width: 979px)').matches) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    }
  }

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
  const countryOf = (item: OnThisDayItem) => payload.countryNames[item.c] ?? item.c

  return (
    <div className={styles.layout}>
      <div className={styles.listColumn}>
        <p className={styles.summary}>
          {formatCount(payload.total)} release{payload.total === 1 ? '' : 's'} by artists on
          Ear Clef carry {label(payload.date)} as their exact date, from {countries}{' '}
          {countries === 1 ? 'country' : 'countries'}
          {before2000 > 0 ? `; ${formatCount(before2000)} from before 2000` : '; none from before 2000'}.
        </p>
        {before2000 < payload.total * FEW_OLD_SHARE && (
          <p className={styles.honest}>
            Older records are thin here, and that is the sources, not the music: exact
            release days were rarely written down before the 1990s, so most of the past
            only appears in its year, not on its day.
          </p>
        )}

        <div className={styles.listHead}>
          <h2 className={styles.listTitle}>Releases through the years</h2>
          <label className={styles.toggle}>
            <input type="checkbox" checked={oldOnly} onChange={(event) => setOldOnly(event.target.checked)} />
            Only before 2000
          </label>
        </div>

        {shown.length === 0 && (
          <p className={styles.note}>Nothing from before 2000 carries this exact date.</p>
        )}
        {[...grouped.entries()].map(([decade, items]) => {
          const all = payload.byDecade[decade] ?? items.length
          return (
            <div key={decade} className={styles.decade}>
              <h3 className={styles.decadeTitle}>
                {decade}s
                <span className={styles.decadeCount}>
                  {items.length < all
                    ? `${items.length} of ${formatCount(all)} shown`
                    : `${formatCount(all)} with this exact date`}
                </span>
              </h3>
              <ul className={styles.list}>
                {items.map((item) => (
                  <Item
                    key={itemKey(item)}
                    item={item}
                    countryName={countryOf(item)}
                    current={selected !== null && itemKey(selected) === itemKey(item)}
                    onPlay={play}
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
      </div>

      <aside ref={panelRef} className={styles.panel} aria-labelledby="now-exploring">
        <div className={styles.panelHead}>
          <h2 id="now-exploring" className={styles.panelTitle}>Now exploring</h2>
          {selected && (
            <button type="button" className={styles.back} onClick={() => setSelected(null)}>
              Back to the day’s playlist
            </button>
          )}
        </div>
        {selected?.v ? (
          <>
            {/* One player on the page: choosing a release replaces the
                playlist, it never plays alongside it. */}
            <div className={styles.video}>
              <iframe
                key={selected.v}
                src={`https://www.youtube-nocookie.com/embed/${selected.v}?autoplay=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={`YouTube player: ${selected.vt ?? selected.vs ?? selected.t}`}
              />
            </div>
            <h3 className={styles.songTitle}>{selected.vs ?? selected.t}</h3>
            <p className={styles.songArtist}>
              <ArtistLink item={selected} />
            </p>
            <Context item={selected} countryName={countryOf(selected)} />
          </>
        ) : playable.length > 0 ? (
          <div className={styles.player}>
            <p className={styles.panelNote}>
              Every verified song released on {label(payload.date)}, shuffled — or press ▶
              on any release to explore it.
            </p>
            <QueuePlayer
              key={`on-this-day:${payload.date}`}
              placeName={label(payload.date)}
              year={new Date().getFullYear()}
              pool={[]}
              roster={{}}
              preresolved={playable.map((track) => ({
                videoId: track.videoId,
                title: track.title,
                artistName: track.artistName,
                mbid: track.mbid,
                ...(track.genres.length > 0 && { genres: track.genres }),
                ...(track.place && { place: track.place }),
              }))}
              buttonLabel={`▶ Play ${label(payload.date)} — ${playable.length} song${playable.length === 1 ? '' : 's'}, shuffled`}
              endNote={`That’s every verified song listed for ${label(payload.date)}.`}
            />
            <p className={styles.playNote}>
              {playable.length} of the {shown.length} listed releases can play: a play button
              appears only where a video is verified as this release by this artist.
            </p>
          </div>
        ) : (
          <p className={styles.playNote}>
            None of the releases listed here has a verified video yet, so nothing plays
            for this day.
          </p>
        )}
      </aside>
    </div>
  )
}
