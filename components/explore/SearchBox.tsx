'use client'

import { useRef, useState } from 'react'
import { searchPlace, type PlaceResult } from '@/lib/explore/panelData'
import styles from './SearchBox.module.css'

interface SearchBoxProps {
  onResolved: (place: PlaceResult) => void
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'error'; message: string }

export function SearchBox({ onResolved }: SearchBoxProps) {
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = new FormData(event.currentTarget)
      .get('place')
      ?.toString()
      .trim()
    if (!query) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'searching' })

    try {
      const place = await searchPlace(query, controller.signal)
      if (controller.signal.aborted) return
      setState({ status: 'idle' })
      onResolved(place)
    } catch (error) {
      if (controller.signal.aborted) return
      setState({ status: 'error', message: (error as Error).message })
    }
  }

  return (
    <form className={styles.search} onSubmit={onSubmit} role="search">
      <div className={styles.row}>
        <input
          className={styles.input}
          type="search"
          name="place"
          placeholder="Search a city or country…"
          aria-label="Search a city or country"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className={styles.submit}
          type="submit"
          disabled={state.status === 'searching'}
          aria-label="Search"
        >
          {state.status === 'searching' ? '…' : '→'}
        </button>
      </div>
      {state.status === 'error' && (
        <p className={styles.error}>{state.message}</p>
      )}
      {state.status === 'searching' && (
        <p className={styles.note}>Finding it on the map…</p>
      )}
    </form>
  )
}
