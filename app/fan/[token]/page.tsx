import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArtistBySlug } from '@/lib/content'
import { getFollowStamps } from '@/lib/fans/followNumbers'
import { getFanByShareToken } from '@/lib/fans/store'
import { TIER_LABELS, TIER_ORDER, type ArtistTier } from '@/lib/tiers'
import { SiteNav } from '@/components/SiteNav'
import styles from './shared.module.css'

/**
 * A shared taste map — the public, read-only face of /me, reachable
 * only by its unguessable token. Shows the display name (never the
 * email), follows grouped by the fan's personal tiers, and first-fan
 * stamps. Sharing off = instant 404.
 */

export const dynamic = 'force-dynamic'

interface SharedPageProps {
  params: Promise<{ token: string }>
}

export async function generateMetadata(
  ctx: SharedPageProps,
): Promise<Metadata> {
  const { token } = await ctx.params
  const fan = await getFanByShareToken(token)
  const who = fan?.displayName || 'A fan'
  return {
    title: `${who}'s taste map — Ear Clef`,
    description:
      'A personal musical identity on Ear Clef: followed artists, rotation tiers, and first-fan numbers.',
    robots: { index: false },
  }
}

/** "2026-07-16" → "Jul 2026". */
function sinceLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default async function SharedTasteMapPage(ctx: SharedPageProps) {
  const { token } = await ctx.params
  const fan = await getFanByShareToken(token)
  if (!fan) notFound()

  const stamps = await getFollowStamps(fan.email, fan.follows)
  const rows = fan.follows.flatMap((slug) => {
    const content = getArtistBySlug(slug)
    if (!content) return []
    return [
      {
        slug,
        name: content.hero.name,
        tier: (fan.tiers?.[slug] ?? null) as ArtistTier | null,
        stamp: stamps[slug] ?? null,
      },
    ]
  })

  const groups = [
    ...TIER_ORDER.map((tier) => ({
      label: TIER_LABELS[tier],
      rows: rows.filter((row) => row.tier === tier),
    })),
    { label: 'Following', rows: rows.filter((row) => row.tier === null) },
  ].filter((group) => group.rows.length > 0)

  const who = fan.displayName || 'A fan'

  return (
    <>
      <SiteNav showSections={false} />
      <main className={styles.main}>
        <div className="container">
          <p className={styles.overline}>A taste map on Ear Clef</p>
          <h1 className={styles.title}>{who}</h1>
          <p className={styles.subtitle}>
            Listening since {sinceLabel(fan.createdAt.slice(0, 10))} ·{' '}
            {rows.length} artist{rows.length === 1 ? '' : 's'} followed
          </p>

          {groups.map((group) => (
            <section key={group.label} className={styles.group}>
              <h2 className={styles.groupTitle}>{group.label}</h2>
              <ul className={styles.rows}>
                {group.rows.map((row) => (
                  <li key={row.slug} className={styles.row}>
                    <Link className={styles.artist} href={`/${row.slug}`}>
                      {row.name}
                    </Link>
                    {row.stamp && (
                      <span className={styles.stamp}>
                        Fan&nbsp;#{row.stamp.number} · since{' '}
                        {sinceLabel(row.stamp.since)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className={styles.footerNote}>
            Every artist here has a home on Ear Clef —{' '}
            <Link className={styles.footerLink} href="/">
              start exploring
            </Link>
            , or{' '}
            <Link className={styles.footerLink} href="/me">
              build your own map
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  )
}
