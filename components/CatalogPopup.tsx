'use client'

import { useEffect, useState } from 'react'
import { fetchCatalog, type CatalogResponse } from '@/lib/artist/browserData'
import { coverArtUrl } from '@/lib/links'
import { Modal } from '@/components/Modal'
import styles from './popupBrowser.module.css'

/**
 * The full discography from MusicBrainz, to browse. NO LINKS (owner
 * ruling, Oct 12 2026): every tile used to open a music-service search,
 * which breaks the no-search-links rule. Verified per-release links
 * come later; until then the catalog informs and promises nothing.
 */
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
      subtitle={`${artistName} — the discography on MusicBrainz, to browse; nothing here links out`}
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
                <li key={item.rgid} className={styles.tileWrap}>
                  <div className={styles.tile}>
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
                    {(item.year || item.rare) && (
                      <span className={styles.tileMeta}>
                        {item.year}
                        {item.rare && (
                        <span
                          className={styles.rareChip}
                          title="May be hard to find online"
                        >
                            rare
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}
