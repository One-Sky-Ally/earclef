'use client'

import { useEffect, useState } from 'react'
import {
  fetchCatalog,
  type CatalogResponse,
} from '@/lib/artist/browserData'
import { coverArtUrl, quotedSearch } from '@/lib/links'
import { Modal } from '@/components/Modal'
import styles from './popupBrowser.module.css'

interface CatalogPopupProps {
  mbid: string
  artistName: string
  onClose: () => void
}

type PopupState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalog: CatalogResponse }

export function CatalogPopup({ mbid, artistName, onClose }: CatalogPopupProps) {
  const [state, setState] = useState<PopupState>({ status: 'loading' })
  const [activeKey, setActiveKey] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(mbid, controller.signal)
      .then((catalog) => setState({ status: 'ready', catalog }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [mbid])

  const categories =
    state.status === 'ready' ? state.catalog.categories : []
  const active =
    categories.find((category) => category.key === activeKey) ?? categories[0]

  return (
    <Modal
      title="Full catalog"
      subtitle={`${artistName} — every click opens a YouTube search`}
      onClose={onClose}
    >
      {state.status === 'loading' && (
        <p className={styles.note}>Pulling the discography from MusicBrainz…</p>
      )}
      {state.status === 'error' && (
        <p className={styles.note}>
          Couldn&apos;t load the catalog right now — please try again shortly.
        </p>
      )}
      {state.status === 'ready' && active && (
        <div className={styles.layout}>
          <ul className={styles.sidebar}>
            {categories.map((category) => (
              <li key={category.key}>
                <button
                  type="button"
                  className={`${styles.categoryButton} ${
                    category.key === active.key ? styles.categoryActive : ''
                  }`}
                  onClick={() => setActiveKey(category.key)}
                >
                  <span>{category.label}</span>
                  <span className={styles.count}>{category.items.length}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.main}>
            <ul className={styles.grid}>
              {active.items.map((item) => (
                <li key={item.rgid}>
                  <a
                    className={styles.tile}
                    href={quotedSearch(artistName, item.title)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={styles.cover}
                      src={coverArtUrl(item.rgid)}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.src =
                          '/images/hero-placeholder.svg'
                      }}
                    />
                    <span className={styles.tileTitle}>{item.title}</span>
                    {item.year && (
                      <span className={styles.tileMeta}>{item.year}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}
