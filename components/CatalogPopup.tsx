'use client'

import { useEffect, useState } from 'react'
import {
  fetchCatalog,
  type CatalogItem,
  type CatalogResponse,
} from '@/lib/artist/browserData'
import {
  archiveAudioSearchUrl,
  bandcampSearchUrl,
  coverArtUrl,
} from '@/lib/links'
import {
  resolveListenHref,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import { useListenService } from '@/components/listen/ServiceProvider'
import { Modal } from '@/components/Modal'
import styles from './popupBrowser.module.css'

interface CatalogPopupProps {
  mbid: string
  artistName: string
  /** Show a Bandcamp search per item when the artist's catalog lives there. */
  hasBandcamp?: boolean
  presence?: ArtistServicePresence
  onClose: () => void
}

type PopupState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalog: CatalogResponse }

function isPre1950(item: CatalogItem): boolean {
  return item.year !== undefined && Number(item.year) < 1950
}

export function CatalogPopup({
  mbid,
  artistName,
  hasBandcamp = false,
  presence,
  onClose,
}: CatalogPopupProps) {
  const { service } = useListenService()
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
      subtitle={`${artistName} — every click opens a search, not a guaranteed match`}
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
                  <a
                    className={styles.tile}
                    href={
                      resolveListenHref(service, presence, artistName, item.title)
                        .href
                    }
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
                    {(item.year || item.rare) && (
                      <span className={styles.tileMeta}>
                        {item.year}
                        {item.rare && (
                        <span
                          className={styles.rareChip}
                          title="May be hard to find online — links open a search, not a guaranteed match"
                        >
                            rare
                          </span>
                        )}
                      </span>
                    )}
                  </a>
                  {(hasBandcamp || isPre1950(item)) && (
                    <span className={styles.sources}>
                      {hasBandcamp && (
                        <a
                          className={styles.sourceLink}
                          href={bandcampSearchUrl(artistName, item.title)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Bandcamp ↗
                        </a>
                      )}
                      {isPre1950(item) && (
                        <a
                          className={styles.sourceLink}
                          href={archiveAudioSearchUrl(artistName, item.title)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Archive ↗
                        </a>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}
