'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  DEFAULT_YEAR,
  YEAR_MAX,
  YEAR_MIN,
  type DataSource,
} from '@/lib/explore/counts'
import type { PlaceResult } from '@/lib/explore/panelData'
import type { FocusRequest } from '@/components/explore/GlobeScene'
import { YearSlider } from '@/components/explore/YearSlider'
import { SearchBox } from '@/components/explore/SearchBox'
import {
  CountryPanel,
  type RosterByMbid,
  type SelectedCountry,
} from '@/components/explore/CountryPanel'
import styles from './ExploreClient.module.css'

const GlobeScene = dynamic(
  () => import('@/components/explore/GlobeScene').then((m) => m.GlobeScene),
  {
    ssr: false,
    loading: () => <p className={styles.loading}>Spinning up the world…</p>,
  },
)

export function ExploreClient({ roster = {} }: { roster?: RosterByMbid }) {
  const [range, setRange] = useState<[number, number]>([
    DEFAULT_YEAR,
    DEFAULT_YEAR,
  ])
  const [yearStart, yearEnd] = range
  const [source, setSource] = useState<DataSource | null>(null)
  const [selected, setSelected] = useState<SelectedCountry | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  // Deep-linked country (?c=JM), held until the globe can fly to it.
  const pendingCountry = useRef<string | null>(null)

  // Read the shareable state once on mount: /?from=1969&to=1975&c=JM.
  // Captured synchronously — the URL-writer effect below runs right
  // after this one and would otherwise wipe the params first. (setState
  // still runs from a timeout callback, not the effect body.)
  useEffect(() => {
    const search = window.location.search
    const timer = setTimeout(() => {
      const params = new URLSearchParams(search)
      const from = Number(params.get('from'))
      const to = Number(params.get('to'))
      if (
        Number.isInteger(from) &&
        Number.isInteger(to) &&
        from >= YEAR_MIN &&
        to <= YEAR_MAX &&
        from <= to
      ) {
        setRange([from, to])
      }
      const code = params.get('c')
      if (code && /^[A-Z]{2}$/.test(code)) pendingCountry.current = code
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Keep the URL shareable: era + open panel survive reload and paste.
  useEffect(() => {
    const params = new URLSearchParams()
    if (yearStart !== DEFAULT_YEAR || yearEnd !== DEFAULT_YEAR) {
      params.set('from', String(yearStart))
      params.set('to', String(yearEnd))
    }
    if (selected) params.set('c', selected.code)
    const query = params.toString()
    window.history.replaceState(null, '', query ? `/?${query}` : '/')
  }, [yearStart, yearEnd, selected])

  function onPlaceResolved(place: PlaceResult) {
    setFocusRequest({
      code: place.country,
      name: place.area,
      nonce: (focusRequest?.nonce ?? 0) + 1,
    })
  }

  function onGlobeReady(dataSource: DataSource) {
    setSource(dataSource)
    // The globe can now fly — honor a deep-linked country exactly once.
    if (pendingCountry.current) {
      setFocusRequest({
        code: pendingCountry.current,
        name: pendingCountry.current,
        nonce: (focusRequest?.nonce ?? 0) + 1,
      })
      pendingCountry.current = null
    }
  }

  return (
    <div className={styles.stage}>
      <GlobeScene
        yearStart={yearStart}
        yearEnd={yearEnd}
        paused={selected !== null}
        focusRequest={focusRequest}
        onDataSourceChange={onGlobeReady}
        onCountryClick={setSelected}
      />
      <SearchBox onResolved={onPlaceResolved} />
      {selected && (
        <CountryPanel
          key={`${selected.code}:${yearStart}-${yearEnd}`}
          country={selected}
          yearStart={yearStart}
          yearEnd={yearEnd}
          source={source}
          roster={roster}
          onClose={() => setSelected(null)}
        />
      )}
      <div className={styles.controls}>
        <YearSlider
          start={yearStart}
          end={yearEnd}
          min={YEAR_MIN}
          max={YEAR_MAX}
          onChange={(start, end) => setRange([start, end])}
        />
        {source && (
          <p className={styles.source}>
            {source === 'live'
              ? 'MusicBrainz release data'
              : 'Simulated preview data — the real dataset is precomputing'}
          </p>
        )}
      </div>
    </div>
  )
}
