'use client'

import { useEffect, useState } from 'react'
import {
  fetchVideos,
  type VideosResponse,
} from '@/lib/artist/browserData'
import { youtubeThumbnailUrl, youtubeWatchUrl } from '@/lib/links'
import { Modal } from '@/components/Modal'
import styles from './popupBrowser.module.css'

interface VideosPopupProps {
  channelId: string
  artistName: string
  onClose: () => void
}

type PopupState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; videos: VideosResponse }

export function VideosPopup({
  channelId,
  artistName,
  onClose,
}: VideosPopupProps) {
  const [state, setState] = useState<PopupState>({ status: 'loading' })
  const [activeKey, setActiveKey] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchVideos(channelId, controller.signal)
      .then((videos) => setState({ status: 'ready', videos }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [channelId])

  const categories = state.status === 'ready' ? state.videos.categories : []
  const active =
    categories.find((category) => category.key === activeKey) ?? categories[0]

  return (
    <Modal
      title="Videos"
      subtitle={`${artistName} — official channel uploads`}
      onClose={onClose}
    >
      {state.status === 'loading' && (
        <p className={styles.note}>Tuning the channel…</p>
      )}
      {state.status === 'error' && (
        <p className={styles.note}>
          Couldn&apos;t load videos right now — please try again shortly.
        </p>
      )}
      {state.status === 'ready' && active && (
        <>
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
                    <span className={styles.count}>
                      {category.items.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.main}>
              <ul className={styles.grid}>
                {active.items.map((item) => (
                  <li key={item.videoId}>
                    <a
                      className={styles.tile}
                      href={youtubeWatchUrl(item.videoId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className={styles.thumb}
                        src={youtubeThumbnailUrl(item.videoId)}
                        alt=""
                        loading="lazy"
                      />
                      <span className={styles.tileTitle}>{item.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {state.videos.partial && (
            <p className={styles.partialNote}>
              Showing the channel&apos;s latest uploads — the full archive
              arrives once the YouTube integration is configured.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
