'use client'

import { useEffect, useState } from 'react'
import { setlistFmSearchUrl } from '@/lib/artist/setlistfm'
import styles from './SetlistFmLink.module.css'

type LinkState =
  | { status: 'loading' }
  | { status: 'exact'; url: string }
  | { status: 'search' }

/**
 * The artist's full show history on setlist.fm: their exact page when
 * MusicBrainz lists it for their MBID, else a search — labelled as one.
 */
export function SetlistFmLink({ mbid, artistName }: { mbid?: string; artistName: string }) {
  const [state, setState] = useState<LinkState>(
    mbid ? { status: 'loading' } : { status: 'search' },
  )

  useEffect(() => {
    if (!mbid) return
    const controller = new AbortController()
    fetch(`/api/artist/setlistfm/${mbid}`, { signal: controller.signal })
      .then(async (res) => {
        const body = res.ok ? ((await res.json()) as { url?: string | null }) : null
        setState(body?.url ? { status: 'exact', url: body.url } : { status: 'search' })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'search' })
      })
    return () => controller.abort()
  }, [mbid])

  if (state.status === 'loading') {
    return <p className={styles.line} aria-hidden="true" />
  }

  return (
    <p className={styles.line}>
      {state.status === 'exact' ? (
        <>
          <span className={styles.lead}>Every show on record:</span>
          <a className={styles.link} href={state.url} target="_blank" rel="noreferrer">
            Full show history on setlist.fm ↗
          </a>
        </>
      ) : (
        <>
          <span className={styles.lead}>Looking for more shows?</span>
          <a
            className={styles.link}
            href={setlistFmSearchUrl(artistName)}
            target="_blank"
            rel="noreferrer"
          >
            Search on setlist.fm ↗
          </a>
          <span className={styles.aside}>
            We couldn’t confirm {artistName}’s own setlist.fm page, so this opens a search.
          </span>
        </>
      )}
    </p>
  )
}
