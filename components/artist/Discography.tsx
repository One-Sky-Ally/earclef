'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  fetchCatalog,
  type CatalogItem,
  type CatalogResponse,
} from '@/lib/artist/browserData'
import { bandcampSearchUrl, coverArtUrlLarge } from '@/lib/links'
import {
  resolveListenHref,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import { useListenService } from '@/components/listen/ServiceProvider'
import { SafeImage } from '@/components/ui/SafeImage'
import styles from './Discography.module.css'

/**
 * The discography as a grid, from the same MusicBrainz catalogue the
 * site already reads (Albums, EPs, Singles, Live, Compilations, Remixes).
 * Type and Sort menus work on what the catalogue actually holds — types
 * with nothing in them are not offered. Every link says what it does:
 * a search on the listener's chosen service, never a guessed match.
 */

type Sort = 'oldest' | 'newest' | 'title'

const SORT_LABELS: Record<Sort, string> = {
  oldest: 'Oldest first',
  newest: 'Newest first',
  title: 'Title A–Z',
}

/** Cards before "Show all" — two rows of four. */
const FIRST_CARDS = 8

const dateKey = (item: CatalogItem) => item.date ?? item.year ?? ''

function sortItems(items: CatalogItem[], sort: Sort): CatalogItem[] {
  const sorted = [...items]
  if (sort === 'title') return sorted.sort((a, b) => a.title.localeCompare(b.title))
  // Undated releases go last either way — no date is not "oldest".
  return sorted.sort((a, b) => {
    const da = dateKey(a)
    const db = dateKey(b)
    if (!da || !db) return da ? -1 : db ? 1 : a.title.localeCompare(b.title)
    return sort === 'oldest' ? da.localeCompare(db) : db.localeCompare(da)
  })
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalog: CatalogResponse }

interface DiscographyProps {
  mbid: string
  artistName: string
  presence: ArtistServicePresence
  hasBandcamp: boolean
}

export function Discography({ mbid, artistName, presence, hasBandcamp }: DiscographyProps) {
  const { service } = useListenService()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [type, setType] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('oldest')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(mbid, controller.signal)
      .then((catalog) => setState({ status: 'ready', catalog }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [mbid])

  const categories = useMemo(
    () =>
      state.status === 'ready'
        ? state.catalog.categories.filter((category) => category.items.length > 0)
        : [],
    [state],
  )
  // Albums by default (handoff), else the first type the artist has.
  const activeKey =
    type ?? (categories.some((c) => c.key === 'albums') ? 'albums' : (categories[0]?.key ?? 'all'))
  const items = useMemo(() => {
    const pool =
      activeKey === 'all'
        ? categories.flatMap((category) => category.items)
        : (categories.find((category) => category.key === activeKey)?.items ?? [])
    return sortItems(pool, sort)
  }, [categories, activeKey, sort])
  const total = categories.reduce((sum, category) => sum + category.items.length, 0)

  const controls = (
    <div className={styles.controls}>
      <label className={styles.control}>
        <span className="visually-hidden">Release type</span>
        <select
          value={activeKey}
          onChange={(event) => {
            setType(event.target.value)
            setShowAll(false)
          }}
          disabled={state.status !== 'ready' || categories.length === 0}
        >
          <option value="all">All releases ({total})</option>
          {categories.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label} ({category.items.length})
            </option>
          ))}
        </select>
      </label>
      <label className={styles.control}>
        <span className="visually-hidden">Sort</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.heading}>Explore the discography</h3>
          <p className={styles.sub}>
            Releases and first-release years from MusicBrainz; artwork from the Cover Art Archive.
          </p>
        </div>
        {controls}
      </div>

      {state.status === 'loading' && (
        <ul className={styles.grid} aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className={styles.skeleton} />
          ))}
        </ul>
      )}
      {state.status === 'error' && (
        <p className={styles.note}>
          The discography didn’t load right now — please try again shortly, or{' '}
          <a href={`https://musicbrainz.org/artist/${mbid}`} target="_blank" rel="noreferrer">
            see it on MusicBrainz ↗
          </a>
          .
        </p>
      )}
      {state.status === 'ready' && items.length === 0 && (
        <p className={styles.note}>MusicBrainz lists no releases of this type yet.</p>
      )}
      {state.status === 'ready' && items.length > 0 && (
        <>
          <ul className={styles.grid}>
            {(showAll ? items : items.slice(0, FIRST_CARDS)).map((item) => {
              const listen = resolveListenHref(service, presence, artistName, item.title)
              return (
                <li key={item.rgid} className={styles.card}>
                  <span className={styles.cover}>
                    <span className={styles.coverPlate} aria-hidden="true">
                      {item.title}
                    </span>
                    <SafeImage className={styles.coverImage} src={coverArtUrlLarge(item.rgid)} />
                  </span>
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.meta}>
                    {item.year ?? 'Year unknown'}
                    {item.rare && (
                      <span
                        className={styles.rare}
                        title="May be hard to find online — links open a search, not a guaranteed match"
                      >
                        rare
                      </span>
                    )}
                  </span>
                  {listen.kind === 'search' ? (
                    <a
                      className={styles.listen}
                      href={listen.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${listen.label}: ${item.title}`}
                    >
                      {listen.label} ↗
                    </a>
                  ) : (
                    <span className={styles.absent}>*{listen.note}</span>
                  )}
                  {hasBandcamp && (
                    <a
                      className={styles.secondary}
                      href={bandcampSearchUrl(artistName, item.title)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Search Bandcamp ↗
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
          {items.length > FIRST_CARDS && (
            <button
              type="button"
              className={styles.more}
              onClick={() => setShowAll((open) => !open)}
              aria-expanded={showAll}
            >
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
