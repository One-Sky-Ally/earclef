'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  SECTION_LABELS,
  sumDays,
  type DayTotals,
} from '@/lib/tally/counts'
import styles from './TallyPanel.module.css'

interface TallyPanelProps {
  ownerKey: string
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; days: { day: string; totals: DayTotals }[] }

const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const

const number = new Intl.NumberFormat('en')

/**
 * What visitors do: plays, saves and shares by section of the site,
 * counted anonymously (lib/tally/counts.ts). Totals only — there is
 * nothing here about anyone, because nothing about anyone is kept.
 */
export function TallyPanel({ ownerKey }: TallyPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [period, setPeriod] = useState<number>(7)

  useEffect(() => {
    let live = true
    fetch('/api/studio/tally', { headers: { 'x-owner-key': ownerKey } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { days: { day: string; totals: DayTotals }[] }
        if (live) setState({ status: 'ready', days: body.days })
      })
      .catch(() => live && setState({ status: 'error' }))
    return () => {
      live = false
    }
  }, [ownerKey])

  const table = useMemo(
    () =>
      state.status === 'ready'
        ? sumDays(state.days.slice(0, period).map((entry) => entry.totals))
        : null,
    [state, period],
  )

  if (state.status === 'loading') return <p className={styles.quiet}>Loading counts…</p>
  if (state.status === 'error' || !table) {
    return <p className={styles.error}>The counts could not load — try again shortly.</p>
  }

  return (
    <div className={styles.panel}>
      <div className={styles.periods} role="group" aria-label="Time period">
        {PERIODS.map((option) => (
          <button
            key={option.days}
            type="button"
            className={styles.period}
            aria-pressed={period === option.days}
            onClick={() => setPeriod(option.days)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <dl className={styles.totals}>
        <div>
          <dt>Plays</dt>
          <dd>{number.format(table.totals.play)}</dd>
        </div>
        <div>
          <dt>Saves</dt>
          <dd>{number.format(table.totals.save)}</dd>
        </div>
        <div>
          <dt>Shares</dt>
          <dd>{number.format(table.totals.share)}</dd>
        </div>
      </dl>

      {table.rows.length === 0 ? (
        <p className={styles.quiet}>Nothing counted in this period yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Where</th>
              <th scope="col">Plays</th>
              <th scope="col">Saves</th>
              <th scope="col">Shares</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.section}>
                <th scope="row">{SECTION_LABELS[row.section]}</th>
                <td>{number.format(row.counts.play)}</td>
                <td>{number.format(row.counts.save)}</td>
                <td>{number.format(row.counts.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className={styles.quiet}>
        A play is a song starting (pausing and resuming counts once). A save
        is a ♥. A share is the Share button or a copied taste-map link.
        Visitors whose browsers ask not to be tracked are not counted, and
        days run on UTC.
      </p>
    </div>
  )
}
