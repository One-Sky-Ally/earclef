'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  coverArtUrlLarge,
  listenSearch,
  youtubeThumbnailUrl,
  youtubeThumbnailLargeUrl,
  youtubeWatchUrl,
} from '@/lib/links'
import { blurbKey, normalizedTitle } from '@/lib/feed/blurbKey'
import type { ArtistTier } from '@/lib/tiers'
import { TierFilter, type TierChoice } from '@/components/TierFilter'
import { FeedPostCard } from '@/components/feed/FeedPostCard'
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
  /** Bigger art for the featured cards; falls back to image, then placeholder. */
  imageLarge?: string
  href: string
}

const FEED_LIMIT = 50
// The top of the feed reads like posts; the rest stays a compact list.
const FEATURED_COUNT = 7
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
      imageLarge: coverArtUrlLarge(item.rgid),
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
    // iTunes artwork URLs encode their size — request a bigger render.
    imageLarge: item.image?.replace('100x100', '600x600'),
    href: listenSearch(entry.name, item.title),
  }))
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
      imageLarge: youtubeThumbnailLargeUrl(item.videoId),
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
  const [blurbs, setBlurbs] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  // null = signed out (or unknown): the Following pill stays hidden.
  const [follows, setFollows] = useState<string[] | null>(null)
  const [followingOnly, setFollowingOnly] = useState(false)
  const requestedBlurbs = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/fan')
        if (!res.ok) return
        const body = (await res.json()) as {
          signedIn: boolean
          follows: string[]
        }
        if (!cancelled && body.signedIn) setFollows(body.follows)
      } catch {
        // Signed-out rendering is the safe default.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  // Filter before the newest-50 cut so each tier surfaces its own latest,
  // not just its members of the overall top 50.
  const visible = useMemo(() => {
    if (state.status !== 'ready') return []
    const tierBySlug = new Map(roster.map((entry) => [entry.slug, entry.tier]))
    const followSet = new Set(follows ?? [])
    return state.items
      .filter(
        (item) =>
          tierChoice === 'all' || tierBySlug.get(item.slug) === tierChoice,
      )
      .filter(
        (item) => !followingOnly || followSet.has(item.slug),
      )
      .slice(0, FEED_LIMIT)
  }, [state, tierChoice, roster, follows, followingOnly])

  const featured = useMemo(
    () => visible.slice(0, FEATURED_COUNT),
    [visible],
  )

  // Blurbs for the featured items: cached ones come back instantly, fresh
  // ones pop in when generated. One request per key per mount, tracked in
  // a ref so a throttled generation can't cause a refetch loop.
  useEffect(() => {
    const missing = featured.filter((item) => {
      const key = blurbKey(item.slug, item.type, item.title)
      return !requestedBlurbs.current.has(key)
    })
    if (missing.length === 0) return
    for (const item of missing) {
      requestedBlurbs.current.add(blurbKey(item.slug, item.type, item.title))
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/feed/blurbs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: missing.map((item) => ({
              slug: item.slug,
              artistName: item.artistName,
              title: item.title,
              type: item.type,
              date: item.date,
            })),
          }),
        })
        if (!res.ok) return
        const body = (await res.json()) as { blurbs?: Record<string, string> }
        if (!cancelled && body.blurbs) {
          setBlurbs((current) => ({ ...current, ...body.blurbs }))
        }
      } catch (error) {
        console.error('Blurb fetch failed:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [featured])

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

  const availableTiers = [
    ...new Set(roster.flatMap((entry) => (entry.tier ? [entry.tier] : []))),
  ]
  const rest = visible.slice(FEATURED_COUNT)

  return (
    <>
      <div className={styles.filters}>
        <TierFilter
          available={availableTiers}
          active={tierChoice}
          onChange={setTierChoice}
        />
        {follows && follows.length > 0 && (
          <button
            type="button"
            className={
              followingOnly ? styles.followPillActive : styles.followPill
            }
            onClick={() => setFollowingOnly((current) => !current)}
          >
            ♥ Following
          </button>
        )}
      </div>
      {followingOnly && visible.length === 0 && (
        <p className={styles.note}>
          Nothing new from the artists you follow yet.
        </p>
      )}
      {state.incomplete && (
        <p className={styles.incomplete}>
          Some sources didn&apos;t respond — showing what arrived.
        </p>
      )}
      {visible.length === 0 && (
        <p className={styles.note}>Nothing in this tier yet.</p>
      )}
      <div className={styles.featured}>
        {featured.map((item) => (
          <FeedPostCard
            key={`${item.type}-${item.href}`}
            item={{ ...item, dateLabel: formatFeedDate(item.date) }}
            blurb={blurbs[blurbKey(item.slug, item.type, item.title)]}
          />
        ))}
      </div>
      {rest.length > 0 && !showAll && (
        <button
          type="button"
          className={styles.showMore}
          onClick={() => setShowAll(true)}
        >
          Show {rest.length} more from the roster ↓
        </button>
      )}
      <ol className={styles.list}>
        {(showAll ? rest : []).map((item) => (
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
