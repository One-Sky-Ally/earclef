'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { ArtistServicePresence } from '@/lib/listen/services'
import type { ArtistTier } from '@/lib/tiers'
import { TierFilter, type TierChoice } from '@/components/TierFilter'
import { FeedPostCard } from '@/components/feed/FeedPostCard'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { ServicePicker } from '@/components/listen/ServicePicker'
import styles from './FeedClient.module.css'

export interface RosterEntry {
  slug: string
  name: string
  mbid?: string
  channelId?: string
  itunesId?: string
  tier?: ArtistTier
  presence?: ArtistServicePresence
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
  presence?: ArtistServicePresence
}

const FEED_LIMIT = 50
// Every entry gets the rich treatment, revealed a page at a time.
const PAGE_SIZE = 10
// A batch that hits the server's generation throttle retries once, after
// the throttle window has passed.
const BLURB_RETRY_MS = 22 * 1000
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
      presence: entry.presence,
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
    presence: entry.presence,
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
  // Keys whose blurb fetch finished (with or without a blurb) — cards
  // shimmer until their key settles, then show the blurb or nothing.
  const [settledKeys, setSettledKeys] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [retryTick, setRetryTick] = useState(0)
  // null = signed out (or unknown): the Following pill stays hidden.
  const [follows, setFollows] = useState<string[] | null>(null)
  const [stamps, setStamps] = useState<
    Record<string, { number: number; since: string }>
  >({})
  const [followingOnly, setFollowingOnly] = useState(false)
  const requestedBlurbs = useRef(new Set<string>())
  const retriedBlurbs = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/fan')
        if (!res.ok) return
        const body = (await res.json()) as {
          signedIn: boolean
          follows: string[]
          stamps?: Record<string, { number: number; since: string }>
        }
        if (!cancelled && body.signedIn) {
          setFollows(body.follows)
          setStamps(body.stamps ?? {})
        }
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

  const rendered = useMemo(
    () => visible.slice(0, visibleCount),
    [visible, visibleCount],
  )

  // Blurbs for whatever is on screen: cached ones come back instantly
  // (and free), fresh ones pop in when generated. One request per key per
  // mount, tracked in a ref; a batch that hit the server's generation
  // throttle retries exactly once after the window passes.
  useEffect(() => {
    const missing = rendered.filter((item) => {
      const key = blurbKey(item.slug, item.type, item.title)
      return !requestedBlurbs.current.has(key)
    })
    if (missing.length === 0) return
    const keys = missing.map((item) =>
      blurbKey(item.slug, item.type, item.title),
    )
    for (const key of keys) requestedBlurbs.current.add(key)

    // No cancellation: the effect re-runs whenever another batch reveals
    // or retries, and cancelling an in-flight batch would strand its keys
    // (marked requested, never settled). Keys are deduped via refs, so
    // letting every started batch run to completion is both safe and
    // required. Post-unmount setState is a no-op in React 18+.
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
        const body = res.ok
          ? ((await res.json()) as { blurbs?: Record<string, string> })
          : {}
        if (body.blurbs) {
          setBlurbs((current) => ({ ...current, ...body.blurbs }))
        }

        const unanswered = keys.filter(
          (key) =>
            !(key in (body.blurbs ?? {})) && !retriedBlurbs.current.has(key),
        )
        if (unanswered.length > 0) {
          setTimeout(() => {
            for (const key of unanswered) {
              retriedBlurbs.current.add(key)
              requestedBlurbs.current.delete(key)
            }
            setRetryTick((tick) => tick + 1)
          }, BLURB_RETRY_MS)
        }
      } catch (error) {
        console.error('Blurb fetch failed:', error)
      } finally {
        setSettledKeys((current) => new Set([...current, ...keys]))
      }
    })()
  }, [rendered, retryTick])

  if (state.status === 'loading') {
    return (
      <>
        <p className={styles.note}>Gathering the latest from the roster…</p>
        <FeedSkeleton count={4} />
      </>
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
  const remaining = visible.length - rendered.length

  return (
    <>
      <div className={styles.filters}>
        <TierFilter
          available={availableTiers}
          active={tierChoice}
          onChange={(choice) => {
            setTierChoice(choice)
            setVisibleCount(PAGE_SIZE)
          }}
        />
        {follows && follows.length > 0 && (
          <button
            type="button"
            className={
              followingOnly ? styles.followPillActive : styles.followPill
            }
            onClick={() => {
              setFollowingOnly((current) => !current)
              setVisibleCount(PAGE_SIZE)
            }}
          >
            ♥ Following
          </button>
        )}
        <ServicePicker />
      </div>
      {followingOnly && follows && follows.length > 0 && (
        <ul className={styles.followList}>
          {follows.map((slug) => {
            const entry = roster.find((artist) => artist.slug === slug)
            if (!entry) return null
            const stamp = stamps[slug]
            return (
              <li key={slug}>
                <a className={styles.followChip} href={`/${slug}`}>
                  {entry.name}
                  {stamp && (
                    <span className={styles.followNumber}>#{stamp.number}</span>
                  )}
                </a>
              </li>
            )
          })}
        </ul>
      )}
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
        {rendered.map((item) => {
          const key = blurbKey(item.slug, item.type, item.title)
          return (
            <FeedPostCard
              key={`${item.type}-${item.href}`}
              item={{ ...item, dateLabel: formatFeedDate(item.date) }}
              blurb={blurbs[key]}
              blurbPending={!settledKeys.has(key)}
            />
          )
        })}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          className={styles.showMore}
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          Show {Math.min(PAGE_SIZE, remaining)} more ↓
        </button>
      )}
    </>
  )
}
