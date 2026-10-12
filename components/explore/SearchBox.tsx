'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SearchNotFoundError,
  searchExplore,
  type SearchChoice,
  type SearchResult,
} from '@/lib/explore/panelData'
import styles from './SearchBox.module.css'

interface SearchBoxProps {
  /** A certain match — a place or a MusicBrainz artist — to open on the globe. */
  onResolved: (result: Exclude<SearchChoice, { kind: 'roster' }>) => void
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'error'; message: string }
  | { status: 'notFound'; message: string }
  /** The match is uncertain: the visitor picks, the site never guesses. */
  | { status: 'choices'; query: string; choices: SearchChoice[] }

function choiceLabel(choice: SearchChoice): string {
  switch (choice.kind) {
    case 'roster':
      return choice.artist.name
    case 'artist':
      return choice.artist.name
    default:
      return choice.area
  }
}

function choiceDetail(choice: SearchChoice): string {
  if (choice.detail) return choice.detail
  switch (choice.kind) {
    case 'roster':
      return 'On Ear Clef'
    case 'artist':
      return 'MusicBrainz artist'
    default:
      return 'Place'
  }
}

export function SearchBox({ onResolved }: SearchBoxProps) {
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const router = useRouter()

  function open(result: SearchResult, query: string) {
    if (result.kind === 'choices') {
      setState({ status: 'choices', query, choices: result.choices })
      return
    }
    if (result.kind === 'roster') {
      // The band's own page is the destination — leave the globe.
      router.push(`/${result.artist.slug}`)
      return
    }
    setState({ status: 'idle' })
    onResolved(result)
  }

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
      const result = await searchExplore(query, controller.signal)
      if (controller.signal.aborted) return
      open(result, query)
    } catch (error) {
      if (controller.signal.aborted) return
      const status =
        error instanceof SearchNotFoundError ? 'notFound' : 'error'
      setState({ status, message: (error as Error).message })
    }
  }

  return (
    <form className={styles.search} onSubmit={onSubmit} role="search">
      <div className={styles.row}>
        <input
          className={styles.input}
          type="search"
          name="place"
          placeholder="Search a place or artist…"
          aria-label="Search a city, country, or artist"
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
      {state.status === 'notFound' && (
        <p className={styles.error}>
          {state.message}{' '}
          <Link className={styles.errorLink} href="/get-on-the-map">
            Are you the artist? Get on the map →
          </Link>
        </p>
      )}
      {state.status === 'searching' && (
        <p className={styles.note}>Finding it on the map…</p>
      )}
      {state.status === 'choices' && (
        <div className={styles.choices} role="group" aria-label="Did you mean">
          <p className={styles.choicesHead}>
            Did you mean, for &ldquo;{state.query}&rdquo;:
          </p>
          <ul className={styles.choiceList}>
            {state.choices.map((choice, index) => (
              <li key={`${choice.kind}-${index}`}>
                {choice.kind === 'roster' ? (
                  <Link
                    className={styles.choice}
                    href={`/${choice.artist.slug}`}
                  >
                    <span className={styles.choiceName}>
                      {choiceLabel(choice)}
                    </span>
                    <span className={styles.choiceDetail}>
                      {choiceDetail(choice)} · opens their page →
                    </span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={styles.choice}
                    onClick={() => open(choice, state.query)}
                  >
                    <span className={styles.choiceName}>
                      {choiceLabel(choice)}
                    </span>
                    <span className={styles.choiceDetail}>
                      {choiceDetail(choice)} · on the globe
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.choicesDismiss}
            onClick={() => setState({ status: 'idle' })}
          >
            None of these
          </button>
        </div>
      )}
    </form>
  )
}
