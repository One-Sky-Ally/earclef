'use client'

import { useState } from 'react'
import Link from 'next/link'
import { mixRows, shuffle } from '@/lib/artists/mix'
import { mbidOfKey } from '@/lib/fans/artistKeys'
import { youtubeThumbnailUrl } from '@/lib/links'
import {
  DEFAULT_FOLLOW_TIER,
  TIER_HINTS,
  TIER_LABELS,
  TIER_ORDER,
  type ArtistTier,
} from '@/lib/tiers'
import { ArtistCard, type ArtistCardData } from '@/components/ArtistRows'
import { ScrollRow } from '@/components/ui/ScrollRow'
import { useFanProfile, type FanProfile } from '@/components/fans/useFanProfile'
import styles from './ArtistShelves.module.css'

/**
 * The Artists page rows. Nobody's favourites are shown to everyone
 * (owner ruling, Oct 14 2026):
 * - visitors get a random mix of the whole roster, shuffled per visit;
 * - signed-in listeners get THEIR follows as Heavy rotation / In the mix
 *   / On the radar (On the radar always, with a hint when it is empty),
 *   then a random mix of the artists they don't follow yet.
 * Rows wait for the account check and the shuffle, so the server never
 * renders an order the browser would then reshuffle. The account comes
 * from the shared profile (useFanProfile), so a Follow pressed on a
 * Discover card above shows in these rows at once; an artist with no
 * page yet (Nov 28 2026) is a card that opens their archive card.
 */

type Viewer =
  | { status: 'loading' }
  | { status: 'visitor'; order: string[] }
  | {
      status: 'fan'
      follows: string[]
      tiers: Record<string, ArtistTier>
      artists: NonNullable<FanProfile['artists']>
      order: string[]
    }

const PER_VIEW = 4

/** A followed artist with no page: their card opens the archive card. */
function pagelessCard(key: string, artists: NonNullable<FanProfile['artists']>): ArtistCardData[] {
  const artist = artists[key]
  const mbid = mbidOfKey(key)
  if (!artist || !mbid) return []
  return [
    {
      slug: key,
      name: artist.name,
      identity: 'Not on Ear Clef yet',
      location: 'Archive card',
      thumbUrl: artist.videoId ? youtubeThumbnailUrl(artist.videoId) : null,
      href: `/a/${mbid}`,
    },
  ]
}

function plural(count: number): string {
  return `${count} artist${count === 1 ? '' : 's'}`
}

export function ArtistShelves({ cards }: { cards: ArtistCardData[] }) {
  const fan = useFanProfile()
  // Shuffled once the account check has answered; Shuffle reshuffles.
  const [order, setOrder] = useState<string[] | null>(null)
  if (fan.status !== 'loading' && order === null) {
    setOrder(shuffle(cards.map((card) => card.slug), Math.random))
  }
  // A failed account check renders as a visitor: the safe default.
  const profile = fan.status === 'ready' && fan.profile.signedIn ? fan.profile : null
  const viewer: Viewer =
    order === null
      ? { status: 'loading' }
      : profile
        ? {
            status: 'fan',
            follows: profile.follows,
            tiers: profile.tiers ?? {},
            artists: profile.artists ?? {},
            order,
          }
        : { status: 'visitor', order }

  function reshuffle() {
    setOrder((current) => (current ? shuffle(current, Math.random) : current))
  }

  if (viewer.status === 'loading') {
    return (
      <div className={styles.loading} aria-busy="true">
        <span className="visually-hidden">Loading the artist rows…</span>
        {[0, 1].map((row) => (
          <div key={row} className={styles.skeletonRow} aria-hidden="true">
            <span className={styles.skeletonTitle} />
            <span className={styles.skeletonCards}>
              {Array.from({ length: PER_VIEW }, (_, index) => (
                <span key={index} className={styles.skeletonCard} />
              ))}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const bySlug = new Map(cards.map((card) => [card.slug, card]))
  const followed =
    viewer.status === 'fan'
      ? new Set(viewer.follows.filter((slug) => bySlug.has(slug) || Boolean(viewer.artists[slug])))
      : new Set<string>()
  const mix = viewer.order
    .filter((slug) => !followed.has(slug))
    .flatMap((slug) => bySlug.get(slug) ?? [])

  const mixSection =
    mix.length > 0 ? (
      <section className={styles.mix} aria-labelledby="mix-heading">
        <div className={styles.mixHead}>
          <h2 id="mix-heading" className={styles.mixTitle}>
            {viewer.status === 'fan' ? 'More from the roster' : 'A random mix'}
          </h2>
          <button type="button" className={styles.shuffle} onClick={reshuffle}>
            <span aria-hidden="true">↻</span> Shuffle
          </button>
        </div>
        <p className={styles.mixNote}>
          {viewer.status === 'fan'
            ? `The ${plural(mix.length)} you don’t follow yet, shuffled fresh every visit.`
            : `All ${plural(mix.length)} on Ear Clef, shuffled fresh every visit — not ranked, and nobody’s favourites. Sign in and follow artists to build your own rows.`}
        </p>
        {mixRows(mix).map((row, index, rows) => (
          <div key={index} className={styles.mixRow}>
            <ScrollRow
              id={`mix-${index + 1}`}
              title={`Random mix, row ${index + 1} of ${rows.length}`}
              hideTitle
              level={3}
              perView={PER_VIEW}
              items={row.map((card) => ({
                key: card.slug,
                node: <ArtistCard card={card} />,
              }))}
            />
          </div>
        ))}
      </section>
    ) : null

  if (viewer.status === 'visitor') return mixSection

  const byName = (a: ArtistCardData, b: ArtistCardData) => a.name.localeCompare(b.name)
  const groups = TIER_ORDER.map((tier) => ({
    tier,
    cards: [...followed]
      .filter((slug) => (viewer.tiers[slug] ?? DEFAULT_FOLLOW_TIER) === tier)
      .flatMap((slug) => bySlug.get(slug) ?? pagelessCard(slug, viewer.artists))
      .sort(byName),
  })).filter((group) => group.cards.length > 0 || group.tier === 'on-the-radar')

  return (
    <>
      <p className={styles.yours}>
        Your rows, from the artists you follow. Move an artist with the ♥
        button on their page, or on{' '}
        <Link className={styles.link} href="/me">
          My Taste Map
        </Link>
        .
      </p>
      {groups.map((group) => (
        <div key={group.tier} className={styles.rowWrap}>
          <ScrollRow
            id={`tier-${group.tier}`}
            title={TIER_LABELS[group.tier]}
            note={
              group.cards.length > 0
                ? `${TIER_HINTS[group.tier]} ${plural(group.cards.length)}.`
                : TIER_HINTS[group.tier]
            }
            perView={PER_VIEW}
            items={group.cards.map((card) => ({
              key: card.slug,
              node: <ArtistCard card={card} />,
            }))}
            empty={
              <>
                Nothing here yet. Open any artist&rsquo;s page, tap{' '}
                <strong>♡ Follow</strong> and choose{' '}
                <strong>On the radar</strong> — new discoveries land in this
                row.
                {mix.length > 0 && (
                  <>
                    {' '}
                    <a className={styles.link} href="#mix-heading">
                      Start with the mix below ↓
                    </a>
                  </>
                )}
              </>
            }
          />
        </div>
      ))}
      {mixSection}
    </>
  )
}
