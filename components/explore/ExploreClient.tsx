'use client'

import { useState } from 'react'
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

  function onPlaceResolved(place: PlaceResult) {
    setFocusRequest({
      code: place.country,
      name: place.area,
      nonce: (focusRequest?.nonce ?? 0) + 1,
    })
  }

  return (
    <div className={styles.stage}>
      <GlobeScene
        yearStart={yearStart}
        yearEnd={yearEnd}
        paused={selected !== null}
        focusRequest={focusRequest}
        onDataSourceChange={setSource}
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
