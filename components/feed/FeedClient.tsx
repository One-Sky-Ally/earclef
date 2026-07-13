'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  fetchCatalog,
  fetchItunesReleases,
  fetchVideos,
  type CatalogResponse,
  type ItunesReleasesResponse,
  type VideosResponse,
} from '@/lib/artist/browserData'
import {
  coverArtUrl,
  listenSearch,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from '@/lib/links'
import type { ArtistTier } from '@/lib/tiers'
import { TierFilter, type TierChoice } from '@/components/TierFilter'
import styles from './FeedClient.module.css'

export interface RosterEntry {
  slug: string
  name: string
  mbid?: string
  channelId?: string
  itunesId?: string
  tier?: ArtistTier
}

interface FeedItem {
  type: 'release' | 'video'
  slug: string
  artistName: string
  title: string
  date: string
  image: string
  href: string
}

const FEED_LIMIT = 50
// Prolific channels (daily Shorts) shouldn't drown the rest of the roster.
const VIDEOS_PER_ARTIST = 8

function mbReleaseItems(
  entry: RosterEntry,
  catalog: CatalogResponse,
): FeedItem[] {
  return catalog.categories
    .flatMap((category) => category.items)
    .filter((item) => item.date)
    .map((item) => ({
      type: 'release' as const,
      slug: entry.slug,
      artistName: entry.name,
      title: item.title,
      date: item.date!,
      image: coverArtUrl(item.rgid),
      href: listenSearch(entry.name, item.title),
    }))
}

function itunesReleaseItems(
  entry: RosterEntry,
  releases: ItunesReleasesResponse,
): FeedItem[] {
  return releases.items.map((item) => ({
    type: 'release' as const,
    slug: entry.slug,
    artistName: entry.name,
    title: item.title,
    date: item.date,
    image: item.image ?? '/images/hero-placeholder.svg',
    href: listenSearch(entry.name, item.title),
  }))
}

/**
 * "OK Computer (Deluxe Edition)" and "OK Computer" are the same drop, as are
 * "X (feat. Y) / Z" and "X / Z" — edition tags and feature credits vary by
 * source, so both are stripped from the dedupe key.
 */
function normalizedTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([](feat|ft|with|deluxe|expanded|remaster(ed)?|special)[^)\]]*[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Merge the freshness overlay (iTunes) with the backbone (MusicBrainz):
 * on a duplicate title, the iTunes entry wins (release-day dates on new
 * drops); everything unique from either source stays.
 */
function mergeReleases(overlay: FeedItem[], musicbrainz: FeedItem[]): FeedItem[] {
  const seen = new Map<string, FeedItem>()
  for (const item of [...overlay, ...musicbrainz]) {
    const key = normalizedTitle(item.title)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()]
}

function videoItems(entry: RosterEntry, videos: VideosResponse): FeedItem[] {
  return videos.categories
    .flatMap((category) => category.items)
    .filter((item) => item.publishedAt)
    .map((item) => ({
      type: 'video' as const,
      slug: entry.slug,
      artistName: entry.name,
      title: item.title,
      date: item.publishedAt!,
      image: youtubeThumbnailUrl(item.videoId),
      href: youtubeWatchUrl(item.videoId),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, VIDEOS_PER_ARTIST)
}

function formatFeedDate(date: string): string {
  if (date.length === 4) return date
  if (date.length === 7) {
    const [year, month] = date.split('-')
    const names = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
    return `${names[Number(month) - 1]} ${year}`
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date))
}

type FeedState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; items: FeedItem[]; incomplete: boolean }

export function FeedClient({ roster }: { roster: RosterEntry[] }) {
  const [state, setState] = useState<FeedState>({ status: 'loading' })
  const [tierChoice, setTierChoice] = useState<TierChoice>('all')

  useEffect(() => {
    const controller = new AbortController()

    const sources = roster.flatMap((entry) => {
      const tasks: Promise<FeedItem[]>[] = []
      if (entry.mbid || entry.itunesId) {
        // Backbone (MusicBrainz) + freshness overlay (iTunes, data only —
        // clicks still go to YouTube). Either may fail independently.
        const mbTask: Promise<FeedItem[]> = entry.mbid
          ? fetchCatalog(entry.mbid, controller.signal).then((catalog) =>
              mbReleaseItems(entry, catalog),
            )
          : Promise.resolve([])
        const overlayTask: Promise<FeedItem[]> = entry.itunesId
          ? fetchItunesReleases(entry.itunesId, controller.signal)
              .then((releases) => itunesReleaseItems(entry, releases))
              .catch(() => []) // overlay is best-effort by design
          : Promise.resolve([])
        tasks.push(
          Promise.all([overlayTask, mbTask]).then(([overlay, musicbrainz]) =>
            mergeReleases(overlay, musicbrainz),
          ),
        )
      }
      if (entry.channelId) {
        tasks.push(
          fetchVideos(entry.channelId, controller.signal).then((videos) =>
            videoItems(entry, videos),
          ),
        )
      }
      return tasks
    })

    Promise.allSettled(sources).then((results) => {
      if (controller.signal.aborted) return
      const items = results
        .filter(
          (result): result is PromiseFulfilledResult<FeedItem[]> =>
            result.status === 'fulfilled',
        )
        .flatMap((result) => result.value)
        .sort((a, b) => b.date.localeCompare(a.date))
      const incomplete = results.some((result) => result.status === 'rejected')
      setState(
        items.length > 0
          ? { status: 'ready', items, incomplete }
          : { status: 'empty' },
      )
    })

    return () => controller.abort()
  }, [roster])

  if (state.status === 'loading') {
    return (
      <p className={styles.note}>Gathering the latest from the roster…</p>
    )
  }

  if (state.status === 'empty') {
    return (
      <p className={styles.note}>
        Nothing to show right now — please try again shortly.
      </p>
    )
  }

  // Filter before the newest-50 cut so each tier surfaces its own latest,
  // not just its members of the overall top 50.
  const tierBySlug = new Map(roster.map((entry) => [entry.slug, entry.tier]))
  const availableTiers = [
    ...new Set(roster.flatMap((entry) => (entry.tier ? [entry.tier] : []))),
  ]
  const visible = (
    tierChoice === 'all'
      ? state.items
      : state.items.filter((item) => tierBySlug.get(item.slug) === tierChoice)
  ).slice(0, FEED_LIMIT)

  return (
    <>
      <TierFilter
        available={availableTiers}
        active={tierChoice}
        onChange={setTierChoice}
      />
      {state.incomplete && (
        <p className={styles.incomplete}>
          Some sources didn&apos;t respond — showing what arrived.
        </p>
      )}
      {visible.length === 0 && (
        <p className={styles.note}>Nothing in this tier yet.</p>
      )}
      <ol className={styles.list}>
        {visible.map((item) => (
          <li key={`${item.type}-${item.href}`} className={styles.row}>
            <a
              className={styles.mediaLink}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              tabIndex={-1}
              aria-hidden="true"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={
                  item.type === 'video' ? styles.thumb : styles.cover
                }
                src={item.image}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.src = '/images/hero-placeholder.svg'
                }}
              />
            </a>
            <span className={styles.body}>
              <span className={styles.meta}>
                <span className={styles.badge}>
                  {item.type === 'release' ? 'Release' : 'Video'}
                </span>
                <Link className={styles.artist} href={`/${item.slug}`}>
                  {item.artistName}
                </Link>
              </span>
              <a
                className={styles.title}
                href={item.href}
                target="_blank"
                rel="noreferrer"
              >
                {item.title}
              </a>
              <span className={styles.date}>{formatFeedDate(item.date)}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
