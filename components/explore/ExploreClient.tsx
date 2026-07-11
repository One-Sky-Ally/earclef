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

export function ExploreClient() {
  const [year, setYear] = useState(DEFAULT_YEAR)
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
        year={year}
        paused={selected !== null}
        focusRequest={focusRequest}
        onDataSourceChange={setSource}
        onCountryClick={setSelected}
      />
      <SearchBox onResolved={onPlaceResolved} />
      {selected && (
        <CountryPanel
          key={`${selected.code}:${year}`}
          country={selected}
          year={year}
          source={source}
          onClose={() => setSelected(null)}
        />
      )}
      <div className={styles.controls}>
        <YearSlider
          year={year}
          min={YEAR_MIN}
          max={YEAR_MAX}
          onChange={setYear}
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
