'use client'

import { useEffect, useMemo, useState } from 'react'
import { countInRange, type CountryYearCounts } from '@/lib/explore/counts'
import { isoOf } from '@/lib/explore/geo'
import { loadCountryShapes, loadSharedCounts } from '@/lib/explore/worldData'
import type { SelectedCountry } from '@/components/explore/CountryPanel'
import styles from './CountryList.module.css'

/**
 * The List view: every country with its release count for the chosen
 * year, filterable and sortable, fully keyboard-reachable. Same year
 * and selection as the globe and map; it needs no graphics at all.
 */

interface ListRow {
  code: string
  name: string
}

type SortOrder = 'count' | 'name'

/** Rows shown before "Show all" — a finite page, not a wall. */
const FIRST_PAGE = 40

interface CountryListProps {
  year: number
  selected: SelectedCountry | null
  onCountryClick: (country: SelectedCountry) => void
}

export function CountryList({ year, selected, onCountryClick }: CountryListProps) {
  const [rows, setRows] = useState<ListRow[] | null>(null)
  const [counts, setCounts] = useState<CountryYearCounts | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState('')
  const [order, setOrder] = useState<SortOrder>('count')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { features } = await loadCountryShapes()
        const seen = new Set<string>()
        const built = features.flatMap((feature) => {
          const code = isoOf(feature)
          if (!code || seen.has(code)) return []
          seen.add(code)
          return [{ code, name: feature.properties.ADMIN }]
        })
        if (cancelled) return
        setRows(built)
        const { counts: loaded } = await loadSharedCounts(built.map((row) => row.code))
        if (!cancelled) setCounts(loaded)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const sorted = useMemo(() => {
    if (!rows) return []
    const needle = filter.trim().toLocaleLowerCase()
    const withCounts = rows
      .filter((row) => !needle || row.name.toLocaleLowerCase().includes(needle))
      .map((row) => ({
        ...row,
        count: counts ? countInRange(counts[row.code], year, year) : 0,
      }))
    return withCounts.sort((a, b) =>
      order === 'count'
        ? b.count - a.count || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    )
  }, [rows, counts, filter, order, year])

  if (failed) {
    return (
      <p className={styles.note}>
        The country list would not load here — the search still finds any
        city, country or artist.
      </p>
    )
  }

  if (!rows) return <p className={styles.note}>Gathering the countries…</p>

  const shown = showAll || filter ? sorted : sorted.slice(0, FIRST_PAGE)

  return (
    <div className={styles.list}>
      <div className={styles.controls}>
        <label className={styles.filter}>
          <span className="visually-hidden">Filter countries</span>
          <input
            type="search"
            className={styles.filterInput}
            placeholder="Filter countries"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label className={styles.sort}>
          <span className={styles.sortLabel}>Sort</span>
          <select
            className={styles.sortSelect}
            value={order}
            onChange={(event) => setOrder(event.target.value as SortOrder)}
          >
            <option value="count">Most releases in {year}</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className={styles.note}>No country matches “{filter}”.</p>
      ) : (
        <ol className={styles.rows}>
          {shown.map((row) => (
            <li key={row.code}>
              <button
                type="button"
                className={styles.row}
                aria-current={selected?.code === row.code ? 'true' : undefined}
                onClick={() => onCountryClick({ code: row.code, name: row.name })}
              >
                <span className={styles.name}>{row.name}</span>
                <span className={styles.count}>
                  {counts ? `${row.count.toLocaleString()} releases` : '…'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {!showAll && !filter && sorted.length > FIRST_PAGE && (
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          Show all {sorted.length} countries
        </button>
      )}
      <p className={styles.footnote}>
        Counts are MusicBrainz releases dated {year}. US states, UK nations and
        cities: use the search, or zoom the 3D globe.
      </p>
    </div>
  )
}
