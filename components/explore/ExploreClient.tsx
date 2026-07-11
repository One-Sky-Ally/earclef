'use client'

import dynamic from 'next/dynamic'
import styles from './ExploreClient.module.css'

const GlobeScene = dynamic(
  () => import('@/components/explore/GlobeScene').then((m) => m.GlobeScene),
  {
    ssr: false,
    loading: () => <p className={styles.loading}>Spinning up the world…</p>,
  },
)

export function ExploreClient() {
  return (
    <div className={styles.stage}>
      <GlobeScene />
    </div>
  )
}
