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
  youtubeThumbnailUrl,
  youtubeThumbnailLargeUrl,
  youtubeWatchUrl,
} from '@/lib/links'
import { blurbKey, normalizedTitle } from '@/lib/feed/blurbKey'
import { displayTitle } from '@/lib/feed/displayTitle'
import {
  SEARCH_LABELS,
  musicServiceSearchUrl,
  type ArtistServicePresence,
} from '@/lib/listen/services'
import { isSearchUrl } from '@/lib/play/storedHref'
import type { StoryCard } from '@/lib/stories/types'
import {
  DEFAULT_FOLLOW_TIER,
  TIER_LABELS,
  TIER_ORDER,
  type ArtistTier,
} from '@/lib/tiers'
import { TierFilter, type TierChoice } from '@/components/TierFilter'
import { FeedPostCard } from '@/components/feed/FeedPostCard'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { StoryCardView } from '@/components/stories/StoryCardView'
import { ServicePicker } from '@/components/listen/ServicePicker'
import styles from './FeedClient.module.css'

export interface RosterEntry {
  slug: string
  name: string
  mbid?: string
  channelId?: string
  itunesId?: string
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
  /** Contextless videos (snapshot-classified) demote behind everything. */
  substance?: 'filler'
  presence?: ArtistServicePresence
}

const FEED_LIMIT = 50
// Every entry gets the rich treatment, revealed a page at a time.
const PAGE_SIZE = 10
// Story cards (editorial picks) keep their own section, a few at a time.
const STORIES_PAGE = 3
const UPCOMING_LIMIT = 6

// --- Daily-seeded shuffle for the STORIES section: same order all day,
// fresh order tomorrow. The dated feed itself is never shuffled (owner
// ruling, Oct 12 2026): "newest first" means newest first. ---

function daySeed(): number {
  const day = new Date().toISOString().slice(0, 10)
  let hash = 0
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = result[i]
    result[i] = result[j]
    result[j] = swap
  }
  return result
}

/** Newest first, reliably — the only order the dated feed has. */
function newestFirst(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date))
}
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
      href: musicServiceSearchUrl('appleMusic', entry.name, item.title),
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
    href: musicServiceSearchUrl('appleMusic', entry.name, item.title),
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
  const [extrasCount, setExtrasCount] = useState(PAGE_SIZE)
  const [storiesCount, setStoriesCount] = useState(STORIES_PAGE)
  const [retryTick, setRetryTick] = useState(0)
  // null = signed out (or unknown): no filters — visitors see everything.
  const [follows, setFollows] = useState<string[] | null>(null)
  // The listener's OWN rows; the site's tiers never filter anyone's feed.
  const [tiers, setTiers] = useState<Record<string, ArtistTier>>({})
  const [stamps, setStamps] = useState<
    Record<string, { number: number; since: string }>
  >({})
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
          tiers?: Record<string, ArtistTier>
          stamps?: Record<string, { number: number; since: string }>
        }
        if (!cancelled && body.signedIn) {
          setFollows(body.follows)
          setTiers(body.tiers ?? {})
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

    async function loadFromSnapshot(): Promise<boolean> {
      // The precomputed feed: one fetch instead of ~100. Presence isn't
      // stored in the snapshot — re-attach it from the roster prop.
      try {
        const res = await fetch('/api/feed/snapshot', {
          signal: controller.signal,
        })
        if (!res.ok) return false
        const body = (await res.json()) as {
          items?: Omit<FeedItem, 'presence'>[]
        }
        if (!body.items || body.items.length === 0) return false
        const presenceBySlug = new Map(
          roster.map((entry) => [entry.slug, entry.presence]),
        )
        const items: FeedItem[] = body.items.map((item) => ({
          ...item,
          presence: presenceBySlug.get(item.slug),
        }))
        setState({ status: 'ready', items, incomplete: false })
        return true
      } catch {
        return false
      }
    }

    function loadLive() {
      // Fallback while the first snapshot builds: the original
      // per-artist fan-out.
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
        const incomplete = results.some(
          (result) => result.status === 'rejected',
        )
        setState(
          items.length > 0
            ? { status: 'ready', items, incomplete }
            : { status: 'empty' },
        )
      })
    }

    ;(async () => {
      const served = await loadFromSnapshot()
      if (!served && !controller.signal.aborted) loadLive()
    })()

    return () => controller.abort()
  }, [roster])

  // Published story cards — editorial entries woven into the feed.
  const [storyCards, setStoryCards] = useState<StoryCard[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/stories')
        if (!res.ok) return
        const body = (await res.json()) as { cards?: StoryCard[] }
        if (!cancelled && body.cards) setStoryCards(body.cards)
      } catch {
        // No stories is a fine feed.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const todayIso = new Date().toISOString().slice(0, 10)

  // Visitors (and "All") see everything; a signed-in listener can narrow
  // to their follows or to one of their own rows.
  const inChoice = useMemo(() => {
    const followSet = new Set(follows ?? [])
    return (slug: string) =>
      tierChoice === 'all' ||
      (followSet.has(slug) &&
        (tierChoice === 'following' ||
          (tiers[slug] ?? DEFAULT_FOLLOW_TIER) === tierChoice))
  }, [follows, tiers, tierChoice])

  // Filter before the newest-50 cut so each tier surfaces its own latest,
  // not just its members of the overall top 50. Future-dated releases
  // split into the "Coming" strip; on release day they flow back in here.
  // Filler-classified videos (no named work, no story) get their own
  // dated section below the feed — demoted, never silently deleted, and
  // never out of order inside the main list.
  const { upcoming, visible, extras } = useMemo(() => {
    if (state.status !== 'ready')
      return {
        upcoming: [] as FeedItem[],
        visible: [] as FeedItem[],
        extras: [] as FeedItem[],
      }
    const filtered = state.items.filter((item) => inChoice(item.slug))
    const isUpcoming = (item: FeedItem) =>
      item.type === 'release' && item.date.slice(0, 10) > todayIso
    const current = newestFirst(filtered.filter((item) => !isUpcoming(item)))
    return {
      upcoming: filtered
        .filter(isUpcoming)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, UPCOMING_LIMIT),
      visible: current
        .filter((item) => item.substance !== 'filler')
        .slice(0, FEED_LIMIT),
      extras: current
        .filter((item) => item.substance === 'filler')
        .slice(0, FEED_LIMIT),
    }
  }, [state, inChoice, todayIso])

  // Editorial picks live in their own section, never woven into the
  // dated list — their order rotates daily, which a dated feed can't.
  const stories = useMemo<StoryCard[]>(() => {
    return seededShuffle(
      storyCards.filter((card) => inChoice(card.slug)),
      mulberry32(daySeed() ^ 0x9e3779b9),
    )
  }, [storyCards, inChoice])

  const rendered = useMemo(
    () => [
      ...visible.slice(0, visibleCount),
      ...extras.slice(0, extrasCount),
    ],
    [visible, visibleCount, extras, extrasCount],
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

  const rosterSlugs = new Set(roster.map((entry) => entry.slug))
  const followedHere = (follows ?? []).filter((slug) => rosterSlugs.has(slug))
  const tierCounts = Object.fromEntries(
    TIER_ORDER.map((tier) => [
      tier,
      followedHere.filter((slug) => (tiers[slug] ?? DEFAULT_FOLLOW_TIER) === tier)
        .length,
    ]),
  ) as Record<ArtistTier, number>
  const chosenSlugs =
    tierChoice === 'all'
      ? []
      : followedHere.filter(
          (slug) =>
            tierChoice === 'following' ||
            (tiers[slug] ?? DEFAULT_FOLLOW_TIER) === tierChoice,
        )
  const choiceLabel =
    tierChoice === 'all' || tierChoice === 'following'
      ? 'the artists you follow'
      : `your ${TIER_LABELS[tierChoice]} artists`
  const remaining = visible.length - Math.min(visibleCount, visible.length)
  const remainingExtras = extras.length - Math.min(extrasCount, extras.length)
  const remainingStories = stories.length - Math.min(storiesCount, stories.length)

  function card(item: FeedItem) {
    const key = blurbKey(item.slug, item.type, item.title)
    return (
      <FeedPostCard
        key={`${item.type}-${item.href}`}
        item={{ ...item, dateLabel: formatFeedDate(item.date) }}
        blurb={blurbs[key]}
        blurbPending={!settledKeys.has(key)}
      />
    )
  }

  return (
    <>
      <div className={styles.filters}>
        <TierFilter
          counts={tierCounts}
          active={tierChoice}
          onChange={(choice) => {
            setTierChoice(choice)
            setVisibleCount(PAGE_SIZE)
            setExtrasCount(PAGE_SIZE)
            setStoriesCount(STORIES_PAGE)
          }}
        />
        <ServicePicker />
      </div>
      {follows && followedHere.length === 0 && (
        <p className={styles.note}>
          Follow artists from their pages to filter the feed by your own
          rows — Heavy rotation, In the mix and On the radar.
        </p>
      )}
      {chosenSlugs.length > 0 && (
        <ul className={styles.followList}>
          {chosenSlugs.map((slug) => {
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
      {state.incomplete && (
        <p className={styles.incomplete}>
          Some sources didn&apos;t respond — showing what arrived.
        </p>
      )}
      {visible.length === 0 && tierChoice !== 'all' && (
        <p className={styles.note}>Nothing new from {choiceLabel} yet.</p>
      )}
      {upcoming.length > 0 && (
        <div className={styles.upcomingStrip}>
          {upcoming.map((item) => (
            <a
              key={`${item.slug}-${item.title}`}
              className={styles.upcomingCard}
              // Stored snapshots can carry pre-ruling search hrefs —
              // stored output outlives the generator that wrote it.
              href={
                isSearchUrl(item.href)
                  ? musicServiceSearchUrl(
                      'appleMusic',
                      item.artistName,
                      item.title,
                    )
                  : item.href
              }
              target="_blank"
              rel="noreferrer"
            >
              <span className={styles.comingBadge}>
                Coming {formatFeedDate(item.date)}
              </span>
              <span className={styles.upcomingTitle}>
                {item.artistName} — {displayTitle(item.title)}
              </span>
              <span className={styles.upcomingAction}>
                {SEARCH_LABELS.appleMusic} ↗
              </span>
            </a>
          ))}
        </div>
      )}
      {stories.length > 0 && (
        <section aria-labelledby="feed-stories-heading">
          <h2 id="feed-stories-heading" className={styles.sectionHead}>
            Ear Clef stories
          </h2>
          <p className={styles.sectionNote}>
            Editorial picks, rotating daily — not part of the dated feed.
          </p>
          <div className={styles.featured}>
            {stories.slice(0, storiesCount).map((card) => (
              <StoryCardView key={card.id} card={card} showArtist />
            ))}
          </div>
          {remainingStories > 0 && (
            <button
              type="button"
              className={styles.showMore}
              onClick={() => setStoriesCount((count) => count + STORIES_PAGE)}
            >
              Show {Math.min(STORIES_PAGE, remainingStories)} more stories ↓
            </button>
          )}
        </section>
      )}
      {visible.length > 0 && (
        <section aria-labelledby="feed-latest-heading">
          <h2 id="feed-latest-heading" className={styles.sectionHead}>
            Latest — newest first
          </h2>
          <div className={styles.featured}>
            {visible.slice(0, visibleCount).map(card)}
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
        </section>
      )}
      {extras.length > 0 && (
        <section aria-labelledby="feed-extras-heading">
          <h2 id="feed-extras-heading" className={styles.sectionHead}>
            Short clips &amp; extras
          </h2>
          <p className={styles.sectionNote}>
            Channel uploads with no named song or story — kept apart from the
            feed, newest first.
          </p>
          <div className={styles.featured}>
            {extras.slice(0, extrasCount).map(card)}
          </div>
          {remainingExtras > 0 && (
            <button
              type="button"
              className={styles.showMore}
              onClick={() => setExtrasCount((count) => count + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, remainingExtras)} more clips ↓
            </button>
          )}
        </section>
      )}
    </>
  )
}
